import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { LookupFunction } from "node:net";
import type { TelemetryJobPayload } from "@sigmon/queues";
import {
  deliverNotification,
  deliverWebhook,
  runAlertEvaluationOnce,
  startAlertScheduler,
  validateWebhookTarget
} from "../src/alerts.js";
import { runBackupOnce } from "../src/backups.js";
import { deliverEmail } from "../src/email.js";
import { startHeartbeat } from "../src/heartbeat.js";
import { checkHttpMonitor, runMonitorEvaluationOnce, startMonitorScheduler } from "../src/monitors.js";
import { runRetentionOnce, startRetentionScheduler } from "../src/retention.js";
import { deleteExpiredSourceMapArtifacts, SourceMapRetentionError } from "../src/source-map-retention.js";
import type { MonitorRecord } from "@sigmon/db/repositories/monitors.js";
import {
  backfillErrorGroupsUntilDrained,
  buildDeadLetterJobInput,
  processTelemetryJob,
  type TelemetryWriter
} from "../src/telemetry-worker.js";

function createWriter(): TelemetryWriter {
  return {
    insertEvent: vi.fn(async () => undefined),
    insertError: vi.fn(async () => undefined),
    insertLlmCall: vi.fn(async () => undefined),
    insertTrace: vi.fn(async () => undefined),
    insertSpan: vi.fn(async () => undefined),
    insertBreadcrumb: vi.fn(async () => undefined)
  };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe("processTelemetryJob", () => {
  it("sanitizes and persists event jobs", async () => {
    const writer = createWriter();
    const job: TelemetryJobPayload = {
      kind: "event",
      id: "evt_1",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        timestamp: "2026-01-01T00:00:00.000Z",
        tenant_id: "tenant_1",
        user_id: "user_1",
        session_id: "session_1",
        trace_id: "trace_1",
        source: "sdk-js",
        release: "1.2.3",
        metadata: {
          authorization: "Bearer secret",
          nested: { api_key: "key" }
        },
        name: "checkout.started",
        properties: {
          plan: "pro",
          password: "secret",
          nested: { token: "secret-token" }
        }
      }
    };

    await processTelemetryJob(job, writer);

    expect(writer.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "evt_1",
        projectId: "prj_1",
        environmentId: "env_1",
        tenantId: "tenant_1",
        userId: "user_1",
        sessionId: "session_1",
        traceId: "trace_1",
        source: "sdk-js",
        release: "1.2.3",
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
        receivedAt: expect.any(Date),
        name: "checkout.started",
        metadata: {
          authorization: "[REDACTED]",
          nested: { api_key: "[REDACTED]" }
        },
        properties: {
          plan: "pro",
          password: "[REDACTED]",
          nested: { token: "[REDACTED]" }
        }
      })
    );
  });

  it("sanitizes and persists error jobs", async () => {
    const writer = createWriter();
    const job: TelemetryJobPayload = {
      kind: "error",
      id: "err_1",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        timestamp: "2026-01-01T00:00:00.000Z",
        metadata: { cookie: "session=secret" },
        message: "Unhandled exception",
        type: "TypeError",
        severity: "critical",
        stack: "stack trace",
        fingerprint: "checkout-type-error",
        context: {
          request: {
            headers: {
              authorization: "Bearer secret"
            }
          },
          password: "secret"
        }
      }
    };

    await processTelemetryJob(job, writer);

    expect(writer.insertError).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "err_1",
        projectId: "prj_1",
        environmentId: "env_1",
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
        receivedAt: expect.any(Date),
        message: "Unhandled exception",
        type: "TypeError",
        severity: "critical",
        stack: "stack trace",
        fingerprint: "checkout-type-error",
        metadata: { cookie: "[REDACTED]" },
        context: {
          request: {
            headers: {
              authorization: "[REDACTED]"
            }
          },
          password: "[REDACTED]"
        }
      })
    );
  });

  it("sanitizes and persists llm jobs", async () => {
    const writer = createWriter();
    const job: TelemetryJobPayload = {
      kind: "llm",
      id: "llm_1",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        timestamp: "2026-01-01T00:00:00.000Z",
        metadata: {
          request: {
            secret_access_key: "aws-secret"
          }
        },
        provider: "openai",
        model: "gpt-5",
        prompt_name: "support-reply",
        input_tokens: 10,
        output_tokens: 20,
        cost_usd: 0.42,
        latency_ms: 1234,
        status: "error",
        error: "provider rejected request authorization: Bearer provider-token",
        input_preview: "user prompt authorization: Bearer provider-token",
        output_preview: "model output password=provider-secret"
      }
    };

    await processTelemetryJob(job, writer);

    expect(writer.insertLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "llm_1",
        projectId: "prj_1",
        environmentId: "env_1",
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
        receivedAt: expect.any(Date),
        provider: "openai",
        model: "gpt-5",
        promptName: "support-reply",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: "0.42",
        latencyMs: 1234,
        status: "error",
        error: "provider rejected request authorization: [REDACTED]",
        inputPreview: "user prompt authorization: [REDACTED]",
        outputPreview: "model output password=[REDACTED]",
        metadata: {
          request: {
            secret_access_key: "[REDACTED]"
          }
        }
      })
    );
  });

  it("sanitizes and persists trace jobs", async () => {
    const writer = createWriter();
    const job: TelemetryJobPayload = {
      kind: "trace",
      id: "trc_1",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        metadata: {
          headers: {
            authorization: "Bearer secret"
          }
        },
        name: "checkout",
        status: "success",
        started_at: "2026-01-01T00:00:01.000Z",
        ended_at: "2026-01-01T00:00:02.000Z",
        duration_ms: 1000
      }
    };

    await processTelemetryJob(job, writer);

    expect(writer.insertTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "trc_1",
        projectId: "prj_1",
        environmentId: "env_1",
        timestamp: new Date("2026-01-01T00:00:01.000Z"),
        receivedAt: expect.any(Date),
        name: "checkout",
        status: "success",
        startedAt: new Date("2026-01-01T00:00:01.000Z"),
        endedAt: new Date("2026-01-01T00:00:02.000Z"),
        durationMs: 1000,
        metadata: {
          headers: {
            authorization: "[REDACTED]"
          }
        }
      })
    );
  });

  it("sanitizes and persists span jobs", async () => {
    const writer = createWriter();
    const job: TelemetryJobPayload = {
      kind: "span",
      id: "spn_1",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        metadata: {
          headers: {
            session_token: "session-secret"
          }
        },
        trace_id: "trc_1",
        parent_span_id: "spn_parent",
        name: "db.query",
        status: "error",
        started_at: "2026-01-01T00:00:01.000Z",
        ended_at: "2026-01-01T00:00:02.000Z",
        duration_ms: 1000,
        input: {
          sql: "select * from users",
          password: "secret"
        },
        output: {
          rows: [{ access_token: "token" }]
        },
        error: {
          message: "query failed",
          private_key: "private"
        },
        cost_usd: 0.03
      }
    };

    await processTelemetryJob(job, writer);

    expect(writer.insertSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "spn_1",
        projectId: "prj_1",
        environmentId: "env_1",
        timestamp: new Date("2026-01-01T00:00:01.000Z"),
        receivedAt: expect.any(Date),
        traceId: "trc_1",
        parentSpanId: "spn_parent",
        name: "db.query",
        status: "error",
        startedAt: new Date("2026-01-01T00:00:01.000Z"),
        endedAt: new Date("2026-01-01T00:00:02.000Z"),
        durationMs: 1000,
        input: {
          sql: "select * from users",
          password: "[REDACTED]"
        },
        output: {
          rows: [{ access_token: "[REDACTED]" }]
        },
        error: {
          message: "query failed",
          private_key: "[REDACTED]"
        },
        costUsd: "0.03",
        metadata: {
          headers: {
            session_token: "[REDACTED]"
          }
        }
      })
    );
  });

  it("persists sanitized breadcrumb jobs", async () => {
    const writer = createWriter();
    const job: TelemetryJobPayload = {
      kind: "breadcrumb",
      id: "brd_1",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        timestamp: "2026-05-11T12:00:00.000Z",
        session_id: "sess_1",
        type: "console",
        category: "browser",
        message: "Failed password=secret",
        level: "error",
        data: { token: "abc", nested: { authorization: "Bearer secret" } }
      }
    };

    await processTelemetryJob(job, writer);

    expect(writer.insertBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "brd_1",
        sessionId: "sess_1",
        type: "console",
        category: "browser",
        message: "Failed password=[REDACTED]",
        level: "error",
        data: {
          token: "[REDACTED]",
          nested: { authorization: "[REDACTED]" }
        }
      })
    );
  });
});

describe("backfillErrorGroupsUntilDrained", () => {
  it("drains backfill batches until the final partial batch", async () => {
    const backfill = vi
      .fn()
      .mockResolvedValueOnce({ processed: 500, selected: 500, batchSize: 500 })
      .mockResolvedValueOnce({ processed: 500, selected: 500, batchSize: 500 })
      .mockResolvedValueOnce({ processed: 123, selected: 123, batchSize: 500 });

    const result = await backfillErrorGroupsUntilDrained(backfill, 500);

    expect(result).toEqual({ processed: 1123, selected: 1123, batches: 3 });
    expect(backfill).toHaveBeenCalledTimes(3);
    expect(backfill).toHaveBeenNthCalledWith(1, { batchSize: 500 });
    expect(backfill).toHaveBeenNthCalledWith(2, { batchSize: 500 });
    expect(backfill).toHaveBeenNthCalledWith(3, { batchSize: 500 });
  });

  it("continues draining when a full selected batch was already processed elsewhere", async () => {
    const backfill = vi
      .fn()
      .mockResolvedValueOnce({ processed: 0, selected: 500, batchSize: 500 })
      .mockResolvedValueOnce({ processed: 25, selected: 25, batchSize: 500 });

    const result = await backfillErrorGroupsUntilDrained(backfill, 500);

    expect(result).toEqual({ processed: 25, selected: 525, batches: 2 });
    expect(backfill).toHaveBeenCalledTimes(2);
  });

  it("uses the repository effective batch size when deciding whether to continue", async () => {
    const backfill = vi
      .fn()
      .mockResolvedValueOnce({ processed: 500, selected: 500, batchSize: 500 })
      .mockResolvedValueOnce({ processed: 10, selected: 10, batchSize: 500 });

    const result = await backfillErrorGroupsUntilDrained(backfill, 1000);

    expect(result).toEqual({ processed: 510, selected: 510, batches: 2 });
    expect(backfill).toHaveBeenCalledTimes(2);
  });
});

describe("buildDeadLetterJobInput", () => {
  it("sanitizes failed job payloads and error messages", () => {
    expect(
      buildDeadLetterJobInput({
        queueName: "telemetry",
        jobName: "event",
        payload: {
          kind: "event",
          payload: {
            metadata: {
              authorization: "Bearer token"
            }
          }
        },
        error: new Error("authorization: Bearer worker-token")
      })
    ).toEqual({
      projectId: null,
      environmentId: null,
      queueName: "telemetry",
      jobName: "event",
      payload: {
        kind: "event",
        payload: {
          metadata: {
            authorization: "[REDACTED]"
          }
        }
      },
      errorMessage: "authorization: [REDACTED]"
    });
  });

  it("preserves project and environment scope from telemetry jobs", () => {
    expect(
      buildDeadLetterJobInput({
        queueName: "telemetry",
        jobName: "error",
        payload: {
          id: "job_1",
          projectId: "prj_1",
          environmentId: "env_1",
          kind: "error",
          payload: { message: "failed" }
        },
        error: new Error("insert failed")
      })
    ).toMatchObject({
      projectId: "prj_1",
      environmentId: "env_1",
      queueName: "telemetry",
      jobName: "error"
    });
  });
});

describe("backup scheduler integration helpers", () => {
  it("records a scheduled backup through injected dependencies", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "sigmon-main-backups-"));
    const recordBackupRun = vi.fn(async (input) => input);
    try {
      const result = await runBackupOnce({
        now: () => new Date("2026-05-06T12:00:00.000Z"),
        trigger: "scheduled",
        config: {
          enabled: true,
          intervalHours: 24,
          localDir,
          retentionDays: 14,
          databaseUrl: "postgres://user:pass@localhost:5432/sigmon",
          s3: {
            enabled: false,
            endpoint: "",
            region: "auto",
            bucket: "",
            accessKeyId: "",
            secretAccessKey: "",
            prefix: "sigmon"
          }
        },
        withLock: async (run) => ({ locked: true, result: await run() }),
        dumpDatabase: async ({ outputPath }) => {
          await writeFile(outputPath, "backup-content");
        },
        recordBackupRun
      });

      expect(result).toEqual({ ran: true, skipped: false });
      expect(recordBackupRun).toHaveBeenCalledWith(
        expect.objectContaining({ status: "success", trigger: "scheduled" })
      );
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });
});

describe("deleteExpiredSourceMapArtifacts", () => {
  it("deletes expired source-map files before metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sigmon-sourcemaps-"));
    const filePath = path.join(root, "artifact.map");
    try {
      await writeFile(filePath, "{}");
      const calls: string[] = [];

      const result = await deleteExpiredSourceMapArtifacts({
        localDir: root,
        now: new Date("2026-05-13T00:00:00.000Z"),
        retentionDays: 30,
        batchSize: 10,
        listExpiredArtifacts: async () => [
          {
            id: "smap_1",
            projectId: "prj_1",
            environmentId: "env_1",
            release: "web@1",
            minifiedFile: "app.js",
            originalFilename: "app.js.map",
            contentType: "application/json",
            byteSize: 2,
            sha256: "sha",
            storagePath: filePath,
            uploadedByUserId: "usr_1",
            uploadedByTokenId: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            deletedAt: null
          }
        ],
        softDeleteArtifact: async (id) => {
          calls.push(id);
          return {
            id,
            projectId: "prj_1",
            environmentId: "env_1",
            release: "web@1",
            minifiedFile: "app.js",
            originalFilename: "app.js.map",
            contentType: "application/json",
            byteSize: 2,
            sha256: "sha",
            storagePath: filePath,
            uploadedByUserId: "usr_1",
            uploadedByTokenId: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            deletedAt: new Date("2026-05-13T00:00:00.000Z")
          };
        }
      });

      await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(calls).toEqual(["smap_1"]);
      expect(result).toEqual({ sourceMapArtifacts: 1, sourceMapFiles: 1 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("tolerates missing source-map files and still removes metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sigmon-sourcemaps-"));
    const filePath = path.join(root, "missing.map");
    try {
      const deletedIds: string[] = [];

      const result = await deleteExpiredSourceMapArtifacts({
        localDir: root,
        now: new Date("2026-05-13T00:00:00.000Z"),
        retentionDays: 30,
        batchSize: 10,
        listExpiredArtifacts: async () => [
          {
            id: "smap_missing",
            projectId: "prj_1",
            environmentId: "env_1",
            release: "web@1",
            minifiedFile: "app.js",
            originalFilename: "app.js.map",
            contentType: "application/json",
            byteSize: 2,
            sha256: "sha",
            storagePath: filePath,
            uploadedByUserId: "usr_1",
            uploadedByTokenId: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            deletedAt: null
          }
        ],
        softDeleteArtifact: async (id) => {
          deletedIds.push(id);
          return {
            id,
            projectId: "prj_1",
            environmentId: "env_1",
            release: "web@1",
            minifiedFile: "app.js",
            originalFilename: "app.js.map",
            contentType: "application/json",
            byteSize: 2,
            sha256: "sha",
            storagePath: filePath,
            uploadedByUserId: "usr_1",
            uploadedByTokenId: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            deletedAt: new Date("2026-05-13T00:00:00.000Z")
          };
        }
      });

      expect(deletedIds).toEqual(["smap_missing"]);
      expect(result).toEqual({ sourceMapArtifacts: 1, sourceMapFiles: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("tolerates missing source-map parent directories and still removes metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sigmon-sourcemaps-"));
    const filePath = path.join(root, "missing-parent", "missing.map");
    try {
      const deletedIds: string[] = [];

      const result = await deleteExpiredSourceMapArtifacts({
        localDir: root,
        now: new Date("2026-05-13T00:00:00.000Z"),
        retentionDays: 30,
        batchSize: 10,
        listExpiredArtifacts: async () => [
          {
            id: "smap_missing_parent",
            projectId: "prj_1",
            environmentId: "env_1",
            release: "web@1",
            minifiedFile: "app.js",
            originalFilename: "app.js.map",
            contentType: "application/json",
            byteSize: 2,
            sha256: "sha",
            storagePath: filePath,
            uploadedByUserId: "usr_1",
            uploadedByTokenId: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            deletedAt: null
          }
        ],
        softDeleteArtifact: async (id) => {
          deletedIds.push(id);
          return {
            id,
            projectId: "prj_1",
            environmentId: "env_1",
            release: "web@1",
            minifiedFile: "app.js",
            originalFilename: "app.js.map",
            contentType: "application/json",
            byteSize: 2,
            sha256: "sha",
            storagePath: filePath,
            uploadedByUserId: "usr_1",
            uploadedByTokenId: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            deletedAt: new Date("2026-05-13T00:00:00.000Z")
          };
        }
      });

      expect(deletedIds).toEqual(["smap_missing_parent"]);
      expect(result).toEqual({ sourceMapArtifacts: 1, sourceMapFiles: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("tolerates source-map files disappearing before removal and still removes metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sigmon-sourcemaps-"));
    const filePath = path.join(root, "raced.map");
    try {
      await writeFile(filePath, "{}");
      const deletedIds: string[] = [];

      const runtime = {
        localDir: root,
        now: new Date("2026-05-13T00:00:00.000Z"),
        retentionDays: 30,
        batchSize: 10,
        listExpiredArtifacts: async () => [
          {
            id: "smap_raced",
            projectId: "prj_1",
            environmentId: "env_1",
            release: "web@1",
            minifiedFile: "app.js",
            originalFilename: "app.js.map",
            contentType: "application/json",
            byteSize: 2,
            sha256: "sha",
            storagePath: filePath,
            uploadedByUserId: "usr_1",
            uploadedByTokenId: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            deletedAt: null
          }
        ],
        softDeleteArtifact: async (id: string) => {
          deletedIds.push(id);
          return {
            id,
            projectId: "prj_1",
            environmentId: "env_1",
            release: "web@1",
            minifiedFile: "app.js",
            originalFilename: "app.js.map",
            contentType: "application/json",
            byteSize: 2,
            sha256: "sha",
            storagePath: filePath,
            uploadedByUserId: "usr_1",
            uploadedByTokenId: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            deletedAt: new Date("2026-05-13T00:00:00.000Z")
          };
        },
        removeFile: async (resolvedPath: string) => {
          await rm(resolvedPath, { force: true });
          const error = new Error("file disappeared") as Error & { code: string };
          error.code = "ENOENT";
          throw error;
        }
      };

      const result = await deleteExpiredSourceMapArtifacts(runtime);

      expect(deletedIds).toEqual(["smap_raced"]);
      expect(result).toEqual({ sourceMapArtifacts: 1, sourceMapFiles: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects source-map paths outside the local directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sigmon-sourcemaps-"));
    const outside = path.join(tmpdir(), "outside-source-map.map");
    try {
      await writeFile(outside, "{}");

      await expect(
        deleteExpiredSourceMapArtifacts({
          localDir: root,
          now: new Date("2026-05-13T00:00:00.000Z"),
          retentionDays: 30,
          batchSize: 10,
          listExpiredArtifacts: async () => [
            {
              id: "smap_outside",
              projectId: "prj_1",
              environmentId: "env_1",
              release: "web@1",
              minifiedFile: "app.js",
              originalFilename: "app.js.map",
              contentType: "application/json",
              byteSize: 2,
              sha256: "sha",
              storagePath: outside,
              uploadedByUserId: "usr_1",
              uploadedByTokenId: null,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              deletedAt: null
            }
          ],
          softDeleteArtifact: async () => {
            throw new Error("metadata should not be deleted");
          }
        })
      ).rejects.toThrow("source_map_storage_path_invalid");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { force: true });
    }
  });

  it("accepts files stored under the real source-map directory when localDir is a symlink", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sigmon-sourcemaps-"));
    const linkPath = path.join(tmpdir(), `sigmon-sourcemaps-link-${process.pid}-${Date.now()}`);
    try {
      const realRoot = await realpath(root);
      await symlink(realRoot, linkPath, "dir");
      const filePath = path.join(realRoot, "artifact.map");
      await writeFile(filePath, "{}");
      const deletedIds: string[] = [];

      const result = await deleteExpiredSourceMapArtifacts({
        localDir: linkPath,
        now: new Date("2026-05-13T00:00:00.000Z"),
        retentionDays: 30,
        batchSize: 10,
        listExpiredArtifacts: async () => [
          {
            id: "smap_symlink_dir",
            projectId: "prj_1",
            environmentId: "env_1",
            release: "web@1",
            minifiedFile: "app.js",
            originalFilename: "app.js.map",
            contentType: "application/json",
            byteSize: 2,
            sha256: "sha",
            storagePath: filePath,
            uploadedByUserId: "usr_1",
            uploadedByTokenId: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            deletedAt: null
          }
        ],
        softDeleteArtifact: async (id) => {
          deletedIds.push(id);
          return {
            id,
            projectId: "prj_1",
            environmentId: "env_1",
            release: "web@1",
            minifiedFile: "app.js",
            originalFilename: "app.js.map",
            contentType: "application/json",
            byteSize: 2,
            sha256: "sha",
            storagePath: filePath,
            uploadedByUserId: "usr_1",
            uploadedByTokenId: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            deletedAt: new Date("2026-05-13T00:00:00.000Z")
          };
        }
      });

      await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(deletedIds).toEqual(["smap_symlink_dir"]);
      expect(result).toEqual({ sourceMapArtifacts: 1, sourceMapFiles: 1 });
    } finally {
      await rm(linkPath, { force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects symlink source-map artifact paths without deleting target files or metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sigmon-sourcemaps-"));
    try {
      const targetPath = path.join(root, "target.map");
      const linkPath = path.join(root, "artifact.map");
      await writeFile(targetPath, "{}");
      await symlink(targetPath, linkPath);
      let metadataDeleted = false;

      await expect(
        deleteExpiredSourceMapArtifacts({
          localDir: root,
          now: new Date("2026-05-13T00:00:00.000Z"),
          retentionDays: 30,
          batchSize: 10,
          listExpiredArtifacts: async () => [
            {
              id: "smap_symlink_file",
              projectId: "prj_1",
              environmentId: "env_1",
              release: "web@1",
              minifiedFile: "app.js",
              originalFilename: "app.js.map",
              contentType: "application/json",
              byteSize: 2,
              sha256: "sha",
              storagePath: linkPath,
              uploadedByUserId: "usr_1",
              uploadedByTokenId: null,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              deletedAt: null
            }
          ],
          softDeleteArtifact: async () => {
            metadataDeleted = true;
            throw new Error("metadata should not be deleted");
          }
        })
      ).rejects.toThrow("source_map_storage_path_invalid");

      await expect(readFile(targetPath, "utf8")).resolves.toBe("{}");
      expect(metadataDeleted).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects missing source-map files under symlink parents outside the local directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sigmon-sourcemaps-"));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "sigmon-sourcemaps-outside-"));
    try {
      const linkPath = path.join(root, "linked-parent");
      const filePath = path.join(linkPath, "missing.map");
      await symlink(outsideRoot, linkPath, "dir");
      let metadataDeleted = false;

      await expect(
        deleteExpiredSourceMapArtifacts({
          localDir: root,
          now: new Date("2026-05-13T00:00:00.000Z"),
          retentionDays: 30,
          batchSize: 10,
          listExpiredArtifacts: async () => [
            {
              id: "smap_symlink_parent",
              projectId: "prj_1",
              environmentId: "env_1",
              release: "web@1",
              minifiedFile: "app.js",
              originalFilename: "app.js.map",
              contentType: "application/json",
              byteSize: 2,
              sha256: "sha",
              storagePath: filePath,
              uploadedByUserId: "usr_1",
              uploadedByTokenId: null,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              deletedAt: null
            }
          ],
          softDeleteArtifact: async () => {
            metadataDeleted = true;
            throw new Error("metadata should not be deleted");
          }
        })
      ).rejects.toThrow("source_map_storage_path_invalid");

      expect(metadataDeleted).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

describe("runRetentionOnce", () => {
  it("records successful retention runs", async () => {
    const calls: string[] = [];
    const result = await runRetentionOnce({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
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
      },
      withLock: async (run) => {
        const result = await run({
          deleteExpiredTelemetry: async () => ({
            events: 1,
            errors: 2,
            traces: 3,
            spans: 4,
            llmCalls: 5,
            breadcrumbs: 6,
            deadLetterJobs: 0,
            sourceMapArtifacts: 0,
            sourceMapFiles: 0
          }),
          deleteExpiredDeadLetterJobs: async () => 7
        });
        calls.push("released");
        return { locked: true, result };
      },
      deleteExpiredSourceMapArtifacts: async () => ({ sourceMapArtifacts: 0, sourceMapFiles: 0 }),
      recordRetentionRun: async (input) => {
        expect(input.status).toBe("success");
        expect(input.deleted.events).toBe(1);
        expect(input.deleted.deadLetterJobs).toBe(7);
        calls.push("recorded");
      }
    });

    expect(result).toEqual({ ran: true, skipped: false });
    expect(calls).toEqual(["released", "recorded"]);
  });

  it("skips retention when advisory lock is held", async () => {
    const result = await runRetentionOnce({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
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
      },
      withLock: async () => ({ locked: false }),
      deleteExpiredSourceMapArtifacts: async () => {
        throw new Error("should_not_delete_source_maps");
      },
      recordRetentionRun: async () => {
        throw new Error("should_not_record");
      }
    });

    expect(result).toEqual({ ran: false, skipped: true });
  });

  it("records failed retention runs", async () => {
    const calls: string[] = [];
    const result = await runRetentionOnce({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
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
      },
      withLock: async (run) => {
        try {
          const result = await run({
            deleteExpiredTelemetry: async () => {
              throw new Error("authorization: Bearer secret-token");
            }
          }).catch((error: unknown) => {
            throw new Error(`retention_delete_failed: ${error instanceof Error ? error.message : String(error)}`);
          });
          return { locked: true, result };
        } finally {
          calls.push("released");
        }
      },
      deleteExpiredSourceMapArtifacts: async () => {
        throw new Error("should_not_delete_source_maps");
      },
      recordRetentionRun: async (input) => {
        expect(input.status).toBe("failed");
        expect(input.errorMessage).toBe("authorization: [REDACTED]");
        expect(input.deleted).toEqual({
          events: 0,
          errors: 0,
          spans: 0,
          traces: 0,
          llmCalls: 0,
          breadcrumbs: 0,
          deadLetterJobs: 0,
          sourceMapArtifacts: 0,
          sourceMapFiles: 0
        });
        calls.push("recorded");
      }
    });

    expect(result).toEqual({ ran: true, skipped: false });
    expect(calls).toEqual(["released", "recorded"]);
  });

  it("does not write a failed zero-deleted run when success recording fails after deletion", async () => {
    const calls: string[] = [];
    const recordError = new Error("audit unavailable");

    await expect(
      runRetentionOnce({
        now: () => new Date("2026-05-06T12:00:00.000Z"),
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
        },
        withLock: async (run) => {
          try {
            const result = await run({
              deleteExpiredTelemetry: async () => {
                calls.push("deleted");
                return {
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
              }
            });
            return { locked: true, result };
          } finally {
            calls.push("released");
          }
        },
        deleteExpiredSourceMapArtifacts: async () => ({ sourceMapArtifacts: 0, sourceMapFiles: 0 }),
        recordRetentionRun: async (input) => {
          calls.push(`recorded:${input.status}:${input.deleted.events}`);
          throw recordError;
        }
      })
    ).rejects.toThrow(recordError);

    expect(calls).toEqual(["deleted", "released", "recorded:success:1"]);
  });

  it("records source-map deletion counts after telemetry retention releases the lock", async () => {
    const calls: string[] = [];
    const result = await runRetentionOnce({
      now: () => new Date("2026-05-13T12:00:00.000Z"),
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
      },
      withLock: async (run) => {
        const result = await run({
          deleteExpiredTelemetry: async () => {
            calls.push("telemetry");
            return {
              events: 0,
              errors: 0,
              traces: 0,
              spans: 0,
              llmCalls: 0,
              breadcrumbs: 0,
              deadLetterJobs: 0,
          sourceMapArtifacts: 0,
              sourceMapFiles: 0
            };
          }
        });
        calls.push("released");
        return { locked: true, result };
      },
      deleteExpiredSourceMapArtifacts: async () => {
        calls.push("sourceMaps");
        return { sourceMapArtifacts: 2, sourceMapFiles: 2 };
      },
      recordRetentionRun: async (input) => {
        expect(input.deleted.sourceMapArtifacts).toBe(2);
        expect(input.deleted.sourceMapFiles).toBe(2);
        calls.push("recorded");
      }
    });

    expect(result).toEqual({ ran: true, skipped: false });
    expect(calls).toEqual(["telemetry", "released", "sourceMaps", "recorded"]);
  });

  it("skips source-map cleanup when source-map retention is disabled", async () => {
    let sourceMapCleanupCalled = false;

    await runRetentionOnce({
      now: () => new Date("2026-05-13T12:00:00.000Z"),
      policy: {
        eventsDays: 90,
        errorsDays: 180,
        tracesDays: 90,
        spansDays: 90,
        llmCallsDays: 180,
        breadcrumbsDays: 30,
        deadLetterJobsDays: 30,
        sourceMapsEnabled: false,
        sourceMapsDays: 180,
        sourceMapsBatchSize: 100
      },
      withLock: async (run) => ({
        locked: true,
        result: await run({
          deleteExpiredTelemetry: async () => ({
            events: 0,
            errors: 0,
            traces: 0,
            spans: 0,
            llmCalls: 0,
            breadcrumbs: 0,
            deadLetterJobs: 0,
          sourceMapArtifacts: 0,
            sourceMapFiles: 0
          })
        })
      }),
      deleteExpiredSourceMapArtifacts: async () => {
        sourceMapCleanupCalled = true;
        return { sourceMapArtifacts: 1, sourceMapFiles: 1 };
      },
      recordRetentionRun: async (input) => {
        expect(input.deleted.sourceMapArtifacts).toBe(0);
        expect(input.deleted.sourceMapFiles).toBe(0);
      }
    });

    expect(sourceMapCleanupCalled).toBe(false);
  });

  it("records failed retention runs when source-map cleanup fails after telemetry deletion", async () => {
    const calls: string[] = [];
    const result = await runRetentionOnce({
      now: () => new Date("2026-05-13T12:00:00.000Z"),
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
      },
      withLock: async (run) => {
        try {
          const result = await run({
            deleteExpiredTelemetry: async () => {
              calls.push("telemetry");
              return {
                events: 1,
                errors: 0,
                traces: 0,
                spans: 0,
                llmCalls: 0,
                breadcrumbs: 0,
                deadLetterJobs: 0,
          sourceMapArtifacts: 0,
                sourceMapFiles: 0
              };
            }
          });
          return { locked: true, result };
        } finally {
          calls.push("released");
        }
      },
      deleteExpiredSourceMapArtifacts: async () => {
        calls.push("sourceMaps");
        throw new Error("authorization: Bearer source-map-token");
      },
      recordRetentionRun: async (input) => {
        expect(input.status).toBe("failed");
        expect(input.errorMessage).toBe("authorization: [REDACTED]");
        expect(input.deleted).toEqual({
          events: 1,
          errors: 0,
          traces: 0,
          spans: 0,
          llmCalls: 0,
          breadcrumbs: 0,
          deadLetterJobs: 0,
          sourceMapArtifacts: 0,
          sourceMapFiles: 0
        });
        calls.push("recorded");
      }
    });

    expect(result).toEqual({ ran: true, skipped: false });
    expect(calls).toEqual(["telemetry", "released", "sourceMaps", "recorded"]);
  });

  it("records partial source-map counts when source-map cleanup fails after one artifact", async () => {
    const result = await runRetentionOnce({
      now: () => new Date("2026-05-13T12:00:00.000Z"),
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
      },
      withLock: async (run) => ({
        locked: true,
        result: await run({
          deleteExpiredTelemetry: async () => ({
            events: 1,
            errors: 0,
            traces: 0,
            spans: 0,
            llmCalls: 0,
            breadcrumbs: 0,
            deadLetterJobs: 0,
          sourceMapArtifacts: 0,
            sourceMapFiles: 0
          })
        })
      }),
      deleteExpiredSourceMapArtifacts: async () => {
        throw new SourceMapRetentionError("source_map_storage_path_invalid", {
          sourceMapArtifacts: 1,
          sourceMapFiles: 1
        });
      },
      recordRetentionRun: async (input) => {
        expect(input.status).toBe("failed");
        expect(input.errorMessage).toBe("source_map_storage_path_invalid");
        expect(input.deleted).toEqual({
          events: 1,
          errors: 0,
          traces: 0,
          spans: 0,
          llmCalls: 0,
          breadcrumbs: 0,
          deadLetterJobs: 0,
          sourceMapArtifacts: 1,
          sourceMapFiles: 1
        });
      }
    });

    expect(result).toEqual({ ran: true, skipped: false });
  });
});

describe("startRetentionScheduler", () => {
  it("does not overlap retention runs and drains active work on stop", async () => {
    const running = createDeferred();
    const calls: string[] = [];
    const intervalHandle = { id: "retention-interval" } as unknown as ReturnType<typeof setInterval>;
    const timeoutHandle = { id: "retention-startup" } as unknown as ReturnType<typeof setTimeout>;
    const scheduledIntervals: Array<() => void> = [];
    const scheduledTimeouts: Array<() => void> = [];

    const stop = startRetentionScheduler({
      intervalMinutes: 5,
      runOnce: async () => {
        calls.push("run");
        await running.promise;
        calls.push("done");
      },
      setTimeoutFn: ((callback: () => void) => {
        scheduledTimeouts.push(callback);
        return timeoutHandle;
      }) as unknown as typeof setTimeout,
      clearTimeoutFn: vi.fn(),
      setIntervalFn: ((callback: () => void) => {
        scheduledIntervals.push(callback);
        return intervalHandle;
      }) as unknown as typeof setInterval,
      clearIntervalFn: vi.fn()
    });

    scheduledTimeouts[0]?.();
    scheduledIntervals[0]?.();
    expect(calls).toEqual(["run"]);

    const stopped = stop();
    await Promise.resolve();
    expect(calls).toEqual(["run"]);

    running.resolve();
    await stopped;

    expect(calls).toEqual(["run", "done"]);
  });

  it("clears startup and interval timers and does not start work after stop", async () => {
    const intervalHandle = { id: "retention-interval" } as unknown as ReturnType<typeof setInterval>;
    const timeoutHandle = { id: "retention-startup" } as unknown as ReturnType<typeof setTimeout>;
    const scheduledIntervals: Array<() => void> = [];
    const scheduledTimeouts: Array<() => void> = [];
    const clearedIntervals: unknown[] = [];
    const clearedTimeouts: unknown[] = [];
    const runOnce = vi.fn(async () => undefined);

    const stop = startRetentionScheduler({
      intervalMinutes: 5,
      runOnce,
      setTimeoutFn: ((callback: () => void) => {
        scheduledTimeouts.push(callback);
        return timeoutHandle;
      }) as unknown as typeof setTimeout,
      clearTimeoutFn: ((handle: unknown) => {
        clearedTimeouts.push(handle);
      }) as typeof clearTimeout,
      setIntervalFn: ((callback: () => void) => {
        scheduledIntervals.push(callback);
        return intervalHandle;
      }) as unknown as typeof setInterval,
      clearIntervalFn: ((handle: unknown) => {
        clearedIntervals.push(handle);
      }) as typeof clearInterval
    });

    await stop();
    scheduledTimeouts[0]?.();
    scheduledIntervals[0]?.();

    expect(runOnce).not.toHaveBeenCalled();
    expect(clearedTimeouts).toEqual([timeoutHandle]);
    expect(clearedIntervals).toEqual([intervalHandle]);
  });
});

describe("runAlertEvaluationOnce", () => {
  it("creates an alert event and records webhook success when a rule fires", async () => {
    const now = new Date("2026-05-06T12:00:00.000Z");
    const deliveries: unknown[] = [];
    const eventInputs: unknown[] = [];
    const updates: unknown[] = [];
    const deliveredPayloads: unknown[] = [];

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
          routePattern: null,
          minimumSampleSize: 1,
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
        url: "https://hooks.example.com/sigmon",
        emailRecipients: [],
        secretHeaderName: null,
        secretHeaderValue: null,
        hasSecret: false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        archivedAt: null
      }),
      evaluateRule: async (rule, windowStart, windowEnd) => {
        expect(rule.id).toBe("rule_1");
        expect(windowStart).toEqual(new Date("2026-05-06T11:50:00.000Z"));
        expect(windowEnd).toEqual(now);
        return { observedValue: "2" };
      },
      recordAlertEvent: async (input) => {
        eventInputs.push(input);
        return { id: "evt_1" };
      },
      updateRuleEvaluation: async (input) => {
        updates.push(input);
      },
      deliver: async (_channel, payload) => {
        deliveredPayloads.push(payload);
        return { status: "success", responseStatus: 204, errorMessage: null };
      },
      recordDelivery: async (input) => {
        deliveries.push(input);
      }
    });

    expect(result).toEqual({ ran: true, skipped: false, evaluated: 1, triggered: 1 });
    expect(eventInputs).toEqual([
      expect.objectContaining({
        triggeredAt: now,
        windowStart: new Date("2026-05-06T11:50:00.000Z"),
        windowEnd: now,
        observedValue: "2",
        message: "Critical errors threshold reached: 2 >= 1",
        metadata: { ruleType: "critical_errors" }
      })
    ]);
    expect(updates).toEqual([{ ruleId: "rule_1", evaluatedAt: now, triggeredAt: now }]);
    expect(deliveredPayloads).toEqual([
      expect.objectContaining({
        alertEventId: "evt_1",
        ruleId: "rule_1",
        observedValue: "2",
        threshold: "1",
        sigmon: { source: "sigmon" }
      })
    ]);
    expect(deliveries).toEqual([
      {
        alertEventId: "evt_1",
        notificationChannelId: "chn_1",
        status: "success",
        attemptedAt: now,
        responseStatus: 204,
        errorMessage: null
      }
    ]);
  });

  it("suppresses events during cooldown while updating evaluation time", async () => {
    const now = new Date("2026-05-06T12:00:00.000Z");
    const updated: unknown[] = [];
    const evaluateRule = vi.fn(async () => ({ observedValue: "5" }));

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
          routePattern: null,
          minimumSampleSize: 1,
          enabled: true,
          lastEvaluatedAt: null,
          lastTriggeredAt: new Date("2026-05-06T11:45:00.000Z"),
          createdAt: now,
          updatedAt: now,
          archivedAt: null
        }
      ],
      getNotificationChannel: async () => null,
      evaluateRule,
      recordAlertEvent: async () => {
        throw new Error("should not create event");
      },
      updateRuleEvaluation: async (input) => {
        updated.push(input);
      },
      deliver: async () => ({ status: "success", responseStatus: 204, errorMessage: null }),
      recordDelivery: async () => {}
    });

    expect(result).toEqual({ ran: true, skipped: false, evaluated: 1, triggered: 0 });
    expect(evaluateRule).not.toHaveBeenCalled();
    expect(updated).toEqual([{ ruleId: "rule_1", evaluatedAt: now }]);
  });

  it("returns skipped result when alert evaluation lock is not acquired", async () => {
    const result = await runAlertEvaluationOnce({
      now: () => new Date("2026-05-06T12:00:00.000Z"),
      withLock: async () => ({ locked: false }),
      listActiveRules: async () => {
        throw new Error("should_not_list_rules");
      },
      getNotificationChannel: async () => null,
      evaluateRule: async () => ({ observedValue: "0" }),
      recordAlertEvent: async () => ({ id: "evt_1" }),
      updateRuleEvaluation: async () => undefined,
      deliver: async () => ({ status: "success", responseStatus: 204, errorMessage: null }),
      recordDelivery: async () => undefined
    });

    expect(result).toEqual({ ran: false, skipped: true, evaluated: 0, triggered: 0 });
  });

  it("delivers webhooks after the alert evaluation lock is released", async () => {
    const now = new Date("2026-05-06T12:00:00.000Z");
    const calls: string[] = [];

    const result = await runAlertEvaluationOnce({
      now: () => now,
      withLock: async (run) => {
        calls.push("lock:start");
        const result = await run();
        calls.push("lock:released");
        return { locked: true, result };
      },
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
          routePattern: null,
          minimumSampleSize: 1,
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
        url: "https://hooks.example.com/sigmon",
        emailRecipients: [],
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
      updateRuleEvaluation: async () => undefined,
      deliver: async () => {
        calls.push("deliver");
        return { status: "success", responseStatus: 204, errorMessage: null };
      },
      recordDelivery: async () => {
        calls.push("recordDelivery");
      }
    });

    expect(result).toEqual({ ran: true, skipped: false, evaluated: 1, triggered: 1 });
    expect(calls).toEqual(["lock:start", "lock:released", "deliver", "recordDelivery"]);
  });
});

describe("monitor evaluation", () => {
  const now = new Date("2026-05-24T12:00:00.000Z");

  function httpMonitor(overrides: Partial<MonitorRecord> = {}): MonitorRecord {
    return {
      id: "mon_http",
      projectId: "prj_1",
      environmentId: "env_1",
      notificationChannelId: "chn_email",
      kind: "http",
      name: "MicroERP app",
      enabled: true,
      status: "unknown",
      url: "https://microerp.example.com/health",
      method: "GET",
      expectedStatus: "2xx",
      bodyContains: "ok",
      timeoutMs: 3000,
      intervalMinutes: 5,
      failureThreshold: 2,
      recoveryThreshold: 1,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      expectedIntervalMinutes: null,
      graceMinutes: null,
      secretHash: null,
      lastCheckedAt: null,
      lastCheckStatus: null,
      lastCheckLatencyMs: null,
      lastCheckResponseStatus: null,
      lastCheckErrorMessage: null,
      lastHeartbeatAt: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      ...overrides
    };
  }

  function heartbeatMonitor(overrides: Partial<MonitorRecord> = {}): MonitorRecord {
    return {
      id: "mon_queue",
      projectId: "prj_1",
      environmentId: "env_1",
      notificationChannelId: "chn_email",
      kind: "heartbeat",
      name: "MicroERP queue",
      enabled: true,
      status: "up",
      url: null,
      method: null,
      expectedStatus: null,
      bodyContains: null,
      timeoutMs: null,
      intervalMinutes: null,
      failureThreshold: 1,
      recoveryThreshold: 1,
      consecutiveFailures: 0,
      consecutiveSuccesses: 1,
      expectedIntervalMinutes: 5,
      graceMinutes: 1,
      secretHash: "hash_1",
      lastCheckedAt: new Date("2026-05-24T11:55:00.000Z"),
      lastCheckStatus: "success",
      lastCheckLatencyMs: null,
      lastCheckResponseStatus: null,
      lastCheckErrorMessage: null,
      lastHeartbeatAt: new Date("2026-05-24T11:55:00.000Z"),
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      ...overrides
    };
  }

  function emailChannel() {
    return {
      id: "chn_email",
      name: "Ops email",
      type: "email" as const,
      url: null,
      emailRecipients: ["ops@example.com"],
      secretHeaderName: null,
      secretHeaderValue: null,
      hasSecret: false as const,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    };
  }

  it("runs due HTTP monitors and records successful checks", async () => {
    const monitor = httpMonitor({ id: "mon_1" });
    const recordMonitorCheck = vi.fn().mockResolvedValue({ ...monitor, status: "up" });

    const result = await runMonitorEvaluationOnce({
      now: () => now,
      withLock: async (run) => ({ locked: true, result: await run() }),
      maxConcurrency: 2,
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
    expect(recordMonitorCheck).toHaveBeenCalledWith(
      expect.objectContaining({ monitorId: "mon_1", status: "success", latencyMs: 42 })
    );
  });

  it("creates and delivers alert events when heartbeat monitors become stale", async () => {
    const heartbeat = heartbeatMonitor({ id: "mon_queue" });
    const recordAlertEvent = vi.fn().mockResolvedValue({ id: "evt_heartbeat" });
    const recordMonitorCheck = vi.fn().mockResolvedValue({ ...heartbeat, status: "down" });
    const deliver = vi.fn().mockResolvedValue({ status: "success", responseStatus: null, errorMessage: null });
    const recordDelivery = vi.fn();

    const result = await runMonitorEvaluationOnce({
      now: () => new Date("2026-05-24T12:07:00.000Z"),
      withLock: async (run) => ({ locked: true, result: await run() }),
      maxConcurrency: 2,
      listDueHttpMonitors: async () => [],
      listStaleHeartbeatMonitors: async () => [heartbeat],
      checkHttpMonitor: vi.fn(),
      recordMonitorCheck,
      recordAlertEvent,
      getNotificationChannel: vi.fn().mockResolvedValue(emailChannel()),
      deliver,
      recordDelivery
    });

    expect(result).toEqual({ ran: true, skipped: false, checked: 0, staleHeartbeats: 1, triggered: 1 });
    expect(recordMonitorCheck).toHaveBeenCalledWith(
      expect.objectContaining({ monitorId: "mon_queue", status: "failed" })
    );
    expect(recordAlertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        monitor: heartbeat,
        observedValue: "12",
        threshold: "6",
        message: expect.stringContaining("stale")
      })
    );
    expect(deliver).toHaveBeenCalledWith(
      emailChannel(),
      expect.objectContaining({ alertEventId: "evt_heartbeat", ruleType: "heartbeat_monitor" })
    );
    expect(recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ alertEventId: "evt_heartbeat", notificationChannelId: "chn_email", status: "success" })
    );
  });

  it("does not create repeated heartbeat stale alerts while already down", async () => {
    const heartbeat = heartbeatMonitor({ id: "mon_queue", status: "down" });
    const recordAlertEvent = vi.fn();

    const result = await runMonitorEvaluationOnce({
      now: () => new Date("2026-05-24T12:07:00.000Z"),
      withLock: async (run) => ({ locked: true, result: await run() }),
      maxConcurrency: 2,
      listDueHttpMonitors: async () => [],
      listStaleHeartbeatMonitors: async () => [heartbeat],
      checkHttpMonitor: vi.fn(),
      recordMonitorCheck: vi.fn().mockResolvedValue(heartbeat),
      recordAlertEvent,
      getNotificationChannel: vi.fn(),
      deliver: vi.fn(),
      recordDelivery: vi.fn()
    });

    expect(result).toEqual({ ran: true, skipped: false, checked: 0, staleHeartbeats: 1, triggered: 0 });
    expect(recordAlertEvent).not.toHaveBeenCalled();
  });

  it("returns skipped result when monitor evaluation lock is held", async () => {
    const result = await runMonitorEvaluationOnce({
      now: () => now,
      withLock: async () => ({ locked: false }),
      maxConcurrency: 2,
      listDueHttpMonitors: async () => {
        throw new Error("should_not_list_monitors");
      },
      listStaleHeartbeatMonitors: async () => [],
      checkHttpMonitor: vi.fn(),
      recordMonitorCheck: vi.fn(),
      recordAlertEvent: vi.fn(),
      getNotificationChannel: vi.fn(),
      deliver: vi.fn(),
      recordDelivery: vi.fn()
    });

    expect(result).toEqual({ ran: false, skipped: true, checked: 0, staleHeartbeats: 0, triggered: 0 });
  });

  it("checks HTTP monitor status and body content", async () => {
    const result = await checkHttpMonitor({
      monitor: httpMonitor(),
      timeoutMs: 5000,
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestImpl: async () => ({ status: 200, body: "ok", latencyMs: 31 })
    });

    expect(result).toEqual({ status: "success", latencyMs: 31, responseStatus: 200, errorMessage: null });
  });

  it("fails HTTP monitor checks for unsafe targets", async () => {
    const result = await checkHttpMonitor({
      monitor: httpMonitor({ url: "http://127.0.0.1/health" }),
      timeoutMs: 5000,
      requestImpl: async () => ({ status: 200, body: "ok", latencyMs: 31 })
    });

    expect(result).toEqual({
      status: "failed",
      latencyMs: null,
      responseStatus: null,
      errorMessage: "unsafe monitor target"
    });
  });

  it("does not overlap monitor scheduler runs and drains active work on stop", async () => {
    const running = createDeferred();
    const calls: string[] = [];
    const intervalHandle = { id: "monitor-interval" } as unknown as ReturnType<typeof setInterval>;
    const timeoutHandle = { id: "monitor-startup" } as unknown as ReturnType<typeof setTimeout>;
    const scheduledIntervals: Array<() => void> = [];
    const scheduledTimeouts: Array<() => void> = [];

    const stop = startMonitorScheduler({
      intervalMinutes: 1,
      runOnce: async () => {
        calls.push("run");
        await running.promise;
        calls.push("done");
      },
      setTimeoutFn: ((callback: () => void) => {
        scheduledTimeouts.push(callback);
        return timeoutHandle;
      }) as unknown as typeof setTimeout,
      clearTimeoutFn: vi.fn(),
      setIntervalFn: ((callback: () => void) => {
        scheduledIntervals.push(callback);
        return intervalHandle;
      }) as unknown as typeof setInterval,
      clearIntervalFn: vi.fn()
    });

    scheduledTimeouts[0]?.();
    scheduledIntervals[0]?.();
    expect(calls).toEqual(["run"]);

    const stopped = stop();
    running.resolve();
    await stopped;

    expect(calls).toEqual(["run", "done"]);
  });
});

describe("validateWebhookTarget", () => {
  it("rejects webhook URL credentials in all environments", () => {
    expect(() => validateWebhookTarget("https://user:pass@example.com/hook", "development")).toThrow(
      /webhook URL credentials are not allowed/
    );
  });

  it("rejects localhost webhook targets in production", () => {
    expect(() => validateWebhookTarget("http://localhost:3000/hook", "production")).toThrow(
      /unsafe webhook target/
    );
  });

  it("rejects unsafe literal webhook targets in production", () => {
    for (const target of [
      "http://169.254.169.254/latest/meta-data",
      "http://0.0.0.0/hook",
      "http://127.1.2.3/hook",
      "http://[::]/hook",
      "http://[::1]/hook",
      "http://[fc00::1]/hook",
      "http://[fd12:3456::1]/hook",
      "http://[fe80::1]/hook",
      "http://[::ffff:127.0.0.1]/hook",
      "http://[::ffff:7f00:1]/hook",
      "http://[::ffff:169.254.169.254]/hook",
      "http://[::ffff:a00:1]/hook"
    ]) {
      expect(() => validateWebhookTarget(target, "production"), target).toThrow(
        /unsafe webhook target/
      );
    }
  });

  it("rejects IPv4-embedded IPv6 transition webhook targets in development", () => {
    for (const target of [
      "http://[64:ff9b::a9fe:a9fe]/hook",
      "http://[::ffff:0:a9fe:a9fe]/hook",
      "http://[2002:a9fe:a9fe::1]/hook"
    ]) {
      expect(() => validateWebhookTarget(target, "development"), target).toThrow(/unsafe webhook target/);
    }
  });
});

describe("deliverWebhook", () => {
  const now = new Date("2026-05-06T12:00:00.000Z");
  const payload = {
    alertEventId: "evt_1",
    ruleId: "rule_1",
    ruleName: "Errors",
    ruleType: "error_count" as const,
    severity: "warning" as const,
    projectId: "prj_1",
    environmentId: "env_1",
    triggeredAt: now.toISOString(),
    window: { from: "2026-05-06T11:50:00.000Z", to: now.toISOString(), minutes: 10 },
    observedValue: "2",
    threshold: "1",
    message: "Errors threshold reached: 2 >= 1",
    sigmon: { source: "sigmon" as const }
  };
  const resolvePublicHostname = async () => [{ address: "93.184.216.34", family: 4 }];

  it("records non-2xx responses as failed with response status", async () => {
    const requestImpl = vi.fn(async () => ({ status: 500 }));

    const result = await deliverWebhook({
      channel: {
        id: "chn_1",
        name: "Webhook",
        type: "webhook",
        url: "https://hooks.example.com/sigmon",
        secretHeaderName: null,
        secretHeaderValue: null,
        hasSecret: false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        archivedAt: null
      },
      payload,
      timeoutMs: 5000,
      nodeEnv: "production",
      resolveHostname: resolvePublicHostname,
      requestImpl
    });

    expect(result).toEqual({
      status: "failed",
      responseStatus: 500,
      errorMessage: "Webhook returned HTTP 500"
    });
    expect(requestImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: new URL("https://hooks.example.com/sigmon"),
        body: JSON.stringify(payload)
      })
    );
  });

  it("does not follow webhook redirects and records redirect status", async () => {
    const requestImpl = vi.fn(async () => ({ status: 302 }));

    const result = await deliverWebhook({
      channel: {
        id: "chn_1",
        name: "Webhook",
        type: "webhook",
        url: "https://hooks.example.com/sigmon",
        secretHeaderName: null,
        secretHeaderValue: null,
        hasSecret: false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        archivedAt: null
      },
      payload,
      timeoutMs: 5000,
      nodeEnv: "production",
      resolveHostname: resolvePublicHostname,
      requestImpl
    });

    expect(result).toEqual({
      status: "failed",
      responseStatus: 302,
      errorMessage: "Webhook returned HTTP 302"
    });
    expect(requestImpl).toHaveBeenCalledTimes(1);
  });

  it("does not send a production request when the webhook URL includes credentials", async () => {
    for (const url of [
      "https://user@example.com/sigmon",
      "https://:pass@example.com/sigmon",
      "https://user:pass@example.com/sigmon"
    ]) {
      const requestImpl = vi.fn(async () => ({ status: 204 }));

      const result = await deliverWebhook({
        channel: {
          id: "chn_1",
          name: "Webhook",
          type: "webhook",
          url,
          secretHeaderName: null,
          secretHeaderValue: null,
          hasSecret: false,
          enabled: true,
          createdAt: now,
          updatedAt: now,
          archivedAt: null
        },
        payload,
        timeoutMs: 5000,
        nodeEnv: "production",
        resolveHostname: resolvePublicHostname,
        requestImpl
      });

      expect(result, url).toEqual({
        status: "failed",
        responseStatus: null,
        errorMessage: expect.stringMatching(/webhook URL credentials are not allowed/)
      });
      expect(requestImpl, url).not.toHaveBeenCalled();
    }
  });

  it("does not send a production request when a hostname resolves to a private address", async () => {
    for (const address of ["10.0.0.1", "169.254.169.254", "127.0.0.1", "fc00::1", "fe80::1"]) {
      const requestImpl = vi.fn(async () => ({ status: 204 }));

      const result = await deliverWebhook({
        channel: {
          id: "chn_1",
          name: "Webhook",
          type: "webhook",
          url: "https://hooks.example.com/sigmon",
          secretHeaderName: null,
          secretHeaderValue: null,
          hasSecret: false,
          enabled: true,
          createdAt: now,
          updatedAt: now,
          archivedAt: null
        },
        payload,
        timeoutMs: 5000,
        nodeEnv: "production",
        resolveHostname: async () => [{ address }],
        requestImpl
      });

      expect(result, address).toEqual({
        status: "failed",
        responseStatus: null,
        errorMessage: "unsafe webhook target"
      });
      expect(requestImpl, address).not.toHaveBeenCalled();
    }
  });

  it("does not send a development request when a hostname resolves to a private address", async () => {
    const requestImpl = vi.fn(async () => ({ status: 204 }));

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
      timeoutMs: 5000,
      nodeEnv: "development",
      resolveHostname: async () => [{ address: "169.254.169.254", family: 4 }],
      requestImpl
    });

    expect(result).toEqual({
      status: "failed",
      responseStatus: null,
      errorMessage: "unsafe webhook target"
    });
    expect(requestImpl).not.toHaveBeenCalled();
  });

  it("does not send a development request when a hostname resolves to an unsafe IPv4-embedded IPv6 address", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const requestImpl = vi.fn(async () => ({ status: 204 }));

    const result = await deliverWebhook({
      channel: {
        id: "chn_1",
        name: "Webhook",
        type: "webhook",
        url: "https://hooks.example.com/sigmon",
        secretHeaderName: null,
        secretHeaderValue: null,
        hasSecret: false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        archivedAt: null
      },
      payload,
      timeoutMs: 5000,
      nodeEnv: "development",
      resolveHostname: async () => [{ address: "64:ff9b::a9fe:a9fe", family: 6 }],
      fetchImpl,
      requestImpl
    });

    expect(result).toEqual({
      status: "failed",
      responseStatus: null,
      errorMessage: "unsafe webhook target"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(requestImpl).not.toHaveBeenCalled();
  });

  it("does not send a production request when hostname DNS resolution fails", async () => {
    const requestImpl = vi.fn(async () => ({ status: 204 }));

    const result = await deliverWebhook({
      channel: {
        id: "chn_1",
        name: "Webhook",
        type: "webhook",
        url: "https://hooks.example.com/sigmon",
        secretHeaderName: null,
        secretHeaderValue: null,
        hasSecret: false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        archivedAt: null
      },
      payload,
      timeoutMs: 5000,
      nodeEnv: "production",
      resolveHostname: async () => {
        throw new Error("lookup failed");
      },
      requestImpl
    });

    expect(result).toEqual({
      status: "failed",
      responseStatus: null,
      errorMessage: "Webhook DNS resolution failed"
    });
    expect(requestImpl).not.toHaveBeenCalled();
  });

  it("blocks production delivery when connection-time DNS rebinds to a private address", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const requestLookup: LookupFunction = (hostname, _options, callback) => {
      expect(hostname).toBe("hooks.example.com");
      callback(null, "169.254.169.254", 4);
    };

    const result = await deliverWebhook({
      channel: {
        id: "chn_1",
        name: "Webhook",
        type: "webhook",
        url: "https://hooks.example.com/sigmon",
        secretHeaderName: null,
        secretHeaderValue: null,
        hasSecret: false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        archivedAt: null
      },
      payload,
      timeoutMs: 5000,
      nodeEnv: "production",
      resolveHostname: resolvePublicHostname,
      requestLookup,
      fetchImpl
    } as Parameters<typeof deliverWebhook>[0] & { requestLookup: LookupFunction });

    expect(result).toEqual({
      status: "failed",
      responseStatus: null,
      errorMessage: "unsafe webhook target"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks development delivery when connection-time DNS rebinds to a private address", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const requestLookup: LookupFunction = (hostname, _options, callback) => {
      expect(hostname).toBe("hooks.example.com");
      callback(null, "127.0.0.1", 4);
    };

    const result = await deliverWebhook({
      channel: {
        id: "chn_1",
        name: "Webhook",
        type: "webhook",
        url: "https://hooks.example.com/sigmon",
        secretHeaderName: null,
        secretHeaderValue: null,
        hasSecret: false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        archivedAt: null
      },
      payload,
      timeoutMs: 5000,
      nodeEnv: "development",
      resolveHostname: resolvePublicHostname,
      requestLookup,
      fetchImpl
    } as Parameters<typeof deliverWebhook>[0] & { requestLookup: LookupFunction });

    expect(result).toEqual({
      status: "failed",
      responseStatus: null,
      errorMessage: "unsafe webhook target"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends configured secret header when present", async () => {
    const requestImpl = vi.fn(async () => ({ status: 204 }));

    const result = await deliverWebhook({
      channel: {
        id: "chn_1",
        name: "Webhook",
        type: "webhook",
        url: "https://hooks.example.com/sigmon",
        secretHeaderName: "X-SignalMonitor-Secret",
        secretHeaderValue: "secret-value",
        hasSecret: true,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        archivedAt: null
      },
      payload,
      timeoutMs: 5000,
      nodeEnv: "production",
      resolveHostname: resolvePublicHostname,
      requestImpl
    });

    expect(result).toEqual({ status: "success", responseStatus: 204, errorMessage: null });
    expect(requestImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: new URL("https://hooks.example.com/sigmon"),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-SignalMonitor-Secret": "secret-value"
        }),
        body: JSON.stringify(payload)
      })
    );
  });

  it("does not send a request when the secret header name is not an HTTP token", async () => {
    const requestImpl = vi.fn(async () => ({ status: 204 }));

    const result = await deliverWebhook({
      channel: {
        id: "chn_1",
        name: "Webhook",
        type: "webhook",
        url: "https://hooks.example.com/sigmon",
        secretHeaderName: "Bad Header",
        secretHeaderValue: "secret-value",
        hasSecret: true,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        archivedAt: null
      },
      payload,
      timeoutMs: 5000,
      nodeEnv: "production",
      requestImpl
    });

    expect(result).toEqual({
      status: "failed",
      responseStatus: null,
      errorMessage: expect.stringMatching(/invalid webhook secret header name/)
    });
    expect(requestImpl).not.toHaveBeenCalled();
  });

  it("does not send a request when the secret header name is reserved", async () => {
    for (const secretHeaderName of ["Proxy-Authorization", "Connection"]) {
      const requestImpl = vi.fn(async () => ({ status: 204 }));

      const result = await deliverWebhook({
        channel: {
          id: "chn_1",
          name: "Webhook",
          type: "webhook",
          url: "https://hooks.example.com/sigmon",
          secretHeaderName,
          secretHeaderValue: "secret-value",
          hasSecret: true,
          enabled: true,
          createdAt: now,
          updatedAt: now,
          archivedAt: null
        },
        payload,
        timeoutMs: 5000,
        nodeEnv: "production",
        requestImpl
      });

      expect(result, secretHeaderName).toEqual({
        status: "failed",
        responseStatus: null,
        errorMessage: expect.stringMatching(/reserved webhook secret header name/)
      });
      expect(requestImpl, secretHeaderName).not.toHaveBeenCalled();
    }
  });
});

describe("deliverEmail", () => {
  const now = new Date("2026-05-06T12:00:00.000Z");

  function alertPayload() {
    return {
      alertEventId: "evt_1",
      ruleId: "rule_1",
      ruleName: "Errors",
      ruleType: "error_count" as const,
      severity: "warning" as const,
      projectId: "prj_1",
      environmentId: "env_1",
      triggeredAt: now.toISOString(),
      window: { from: "2026-05-06T11:50:00.000Z", to: now.toISOString(), minutes: 10 },
      observedValue: "2",
      threshold: "1",
      message: "Errors threshold reached: 2 >= 1",
      sigmon: { source: "sigmon" as const }
    };
  }

  function emailChannel() {
    return {
      id: "chn_email",
      name: "Ops email",
      type: "email" as const,
      url: null,
      emailRecipients: ["diogo@example.com"],
      secretHeaderName: null,
      secretHeaderValue: null,
      hasSecret: false as const,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    };
  }

  it("delivers email notification channels through SMTP", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "msg_1" });
    const result = await deliverEmail({
      channel: emailChannel(),
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
      timeoutMs: 2500,
      transportFactory: () => ({ sendMail }) as never
    });

    expect(result).toEqual({ status: "success", responseStatus: null, errorMessage: null });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Sigmon <alerts@example.com>",
        to: ["diogo@example.com"],
        subject: expect.stringContaining("Sigmon")
      })
    );
  });

  it("records failed email delivery when SMTP is not configured", async () => {
    const result = await deliverEmail({
      channel: emailChannel(),
      smtp: { enabled: false, host: "", port: 587, username: "", password: "", from: "", secure: false },
      payload: alertPayload(),
      timeoutMs: 2500
    });

    expect(result).toEqual({ status: "failed", responseStatus: null, errorMessage: "SMTP is not configured" });
  });

  it("redacts the SMTP password from email delivery errors", async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error("SMTP auth failed for password"));
    const result = await deliverEmail({
      channel: emailChannel(),
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
      timeoutMs: 2500,
      transportFactory: () => ({ sendMail }) as never
    });

    expect(result).toEqual({
      status: "failed",
      responseStatus: null,
      errorMessage: "SMTP auth failed for [REDACTED]"
    });
  });

  it("dispatches email notification channels with the alert timeout", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "msg_1" });
    const transportFactory = vi.fn(() => ({ sendMail }) as never);

    const result = await deliverNotification({
      channel: emailChannel(),
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
      timeoutMs: 2500,
      nodeEnv: "production",
      emailTransportFactory: transportFactory
    });

    expect(result).toEqual({ status: "success", responseStatus: null, errorMessage: null });
    expect(transportFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: 2500,
        greetingTimeout: 2500,
        socketTimeout: 2500
      })
    );
    expect(sendMail).toHaveBeenCalledOnce();
  });
});

describe("startAlertScheduler", () => {
  it("does not overlap active runs and awaits active run on stop", async () => {
    const running = createDeferred();
    const calls: string[] = [];
    const intervalHandle = { id: "alert-interval" } as unknown as ReturnType<typeof setInterval>;
    const timeoutHandle = { id: "alert-startup" } as unknown as ReturnType<typeof setTimeout>;
    const scheduledIntervals: Array<() => void> = [];
    const scheduledTimeouts: Array<() => void> = [];

    const stop = startAlertScheduler({
      intervalMinutes: 5,
      runOnce: async () => {
        calls.push("run");
        await running.promise;
        calls.push("done");
      },
      setTimeoutFn: ((callback: () => void) => {
        scheduledTimeouts.push(callback);
        return timeoutHandle;
      }) as unknown as typeof setTimeout,
      clearTimeoutFn: vi.fn(),
      setIntervalFn: ((callback: () => void) => {
        scheduledIntervals.push(callback);
        return intervalHandle;
      }) as unknown as typeof setInterval,
      clearIntervalFn: vi.fn()
    });

    scheduledTimeouts[0]?.();
    scheduledIntervals[0]?.();
    expect(calls).toEqual(["run"]);

    const stopped = stop();
    await Promise.resolve();
    expect(calls).toEqual(["run"]);

    running.resolve();
    await stopped;

    expect(calls).toEqual(["run", "done"]);
  });
});

describe("startHeartbeat", () => {
  it("sends a heartbeat immediately and stops scheduled beats", async () => {
    const beat = vi.fn(async () => undefined);
    const scheduled: Array<() => void> = [];
    const cleared: unknown[] = [];
    const intervalHandle = { id: "heartbeat-interval" } as unknown as ReturnType<typeof setInterval>;

    const stop = startHeartbeat({
      beat,
      setIntervalFn: ((callback: () => void) => {
        scheduled.push(callback);
        return intervalHandle;
      }) as unknown as typeof setInterval,
      clearIntervalFn: ((handle: unknown) => {
        cleared.push(handle);
      }) as typeof clearInterval
    });

    expect(beat).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    scheduled[0]?.();
    expect(beat).toHaveBeenCalledTimes(2);

    await stop();

    expect(cleared).toEqual([intervalHandle]);
  });

  it("does not overlap heartbeat calls and drains active work on stop", async () => {
    const running = createDeferred();
    const calls: string[] = [];
    const intervalHandle = { id: "heartbeat-interval" } as unknown as ReturnType<typeof setInterval>;
    const scheduled: Array<() => void> = [];

    const stop = startHeartbeat({
      beat: async () => {
        calls.push("beat");
        await running.promise;
        calls.push("done");
      },
      setIntervalFn: ((callback: () => void) => {
        scheduled.push(callback);
        return intervalHandle;
      }) as unknown as typeof setInterval,
      clearIntervalFn: vi.fn()
    });

    scheduled[0]?.();
    expect(calls).toEqual(["beat"]);

    const stopped = stop();
    await Promise.resolve();
    expect(calls).toEqual(["beat"]);

    running.resolve();
    await stopped;

    expect(calls).toEqual(["beat", "done"]);
  });
});
