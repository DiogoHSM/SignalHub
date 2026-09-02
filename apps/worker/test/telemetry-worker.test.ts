import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { LookupFunction } from "node:net";
import { OutboundPolicy } from "@sigmon/config";
import type { TelemetryJobPayload } from "@sigmon/queues";
import {
  deliverNotification,
  deliverWebhook,
  runAlertEvaluationOnce,
  startAlertScheduler,
  toDiscordPayload,
  toSlackPayload,
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
    getDataGovernancePolicy: vi.fn(async (input) => ({
      projectId: input.projectId,
      environmentId: input.environmentId,
      retentionPolicy: {},
      propertyRules: [],
      updatedByUserId: null,
      createdAt: new Date(0),
      updatedAt: new Date(0)
    })),
    insertEvent: vi.fn(async () => undefined),
    insertError: vi.fn(async () => undefined),
    insertLlmCall: vi.fn(async () => undefined),
    insertTrace: vi.fn(async () => undefined),
    insertSpan: vi.fn(async () => undefined),
    insertWebVital: vi.fn(async () => undefined),
    insertClickEvent: vi.fn(async () => undefined),
    insertSessionReplay: vi.fn(async () => undefined),
    insertProfile: vi.fn(async () => undefined),
    insertSurveyResponse: vi.fn(async () => undefined),
    insertFeedbackItem: vi.fn(async () => undefined),
    insertBreadcrumb: vi.fn(async () => undefined)
  };
}

describe("Task 4 privileged HTTP transport", () => {
  const now = new Date("2026-05-06T12:00:00.000Z");
  const payload = {
    alertEventId: "evt_task4",
    ruleId: "rule_task4",
    ruleName: "Task 4",
    ruleType: "error_count" as const,
    severity: "warning" as const,
    projectId: "prj_1",
    environmentId: "env_1",
    triggeredAt: now.toISOString(),
    window: { from: now.toISOString(), to: now.toISOString(), minutes: 1 },
    observedValue: "2",
    threshold: "1",
    message: "alert",
    sigmon: { source: "sigmon" as const }
  };

  function webhookChannel(overrides: Record<string, unknown> = {}) {
    return {
      id: "chn_task4",
      name: "Webhook",
      type: "webhook" as const,
      url: "https://hooks.example.test/deliver",
      secretHeaderName: null,
      secretHeaderValue: null,
      hasSecret: false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      ...overrides
    };
  }

  function task4HttpMonitor(overrides: Partial<MonitorRecord> = {}): MonitorRecord {
    return {
      id: "mon_task4",
      projectId: "prj_1",
      environmentId: "env_1",
      notificationChannelId: null,
      kind: "http",
      name: "Task 4 monitor",
      enabled: true,
      status: "unknown",
      url: "https://public.example.test/health",
      method: "GET",
      expectedStatus: "2xx",
      bodyContains: "ok",
      timeoutMs: 500,
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

  it("rejects plaintext Slack, Discord, and secret-bearing custom webhook delivery", async () => {
    for (const channel of [
      webhookChannel({ type: "slack", url: "http://hooks.slack.test/token" }),
      webhookChannel({ type: "discord", url: "http://discord.test/token" }),
      webhookChannel({
        url: "http://hooks.example.test/deliver",
        secretHeaderName: "X-Sigmon-Secret",
        secretHeaderValue: null,
        hasSecret: false
      }),
      webhookChannel({
        url: "http://hooks.example.test/deliver",
        secretHeaderName: "X-Sigmon-Secret",
        secretHeaderValue: "header-secret",
        hasSecret: true
      })
    ]) {
      const requestImpl = vi.fn(async () => ({ status: 204 }));
      const result = await deliverWebhook({
        channel: channel as never,
        payload,
        timeoutMs: 500,
        nodeEnv: "production",
        outboundPolicy: new OutboundPolicy({ nodeEnv: "production" }),
        requestImpl
      } as never);

      expect(result, channel.type).toEqual({
        status: "failed",
        responseStatus: null,
        errorMessage: "Webhook HTTPS is required"
      });
      expect(requestImpl).not.toHaveBeenCalled();
    }
  });

  it("allows plaintext secret-bearing delivery only to explicit non-production loopback", async () => {
    const requestImpl = vi.fn(async () => ({ status: 204 }));
    const result = await deliverWebhook({
      channel: webhookChannel({
        url: "http://127.0.0.1:3000/deliver",
        secretHeaderName: "X-Sigmon-Secret",
        secretHeaderValue: "header-secret",
        hasSecret: true
      }),
      payload,
      timeoutMs: 500,
      nodeEnv: "test",
      outboundPolicy: new OutboundPolicy({ nodeEnv: "test", allowLoopback: true }),
      requestImpl
    } as never);

    expect(result).toEqual({ status: "success", responseStatus: 204, errorMessage: null });
    expect(requestImpl).toHaveBeenCalledOnce();
  });

  it("uses one webhook delivery budget across attempts and retry delays", async () => {
    const requestImpl = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { status: 503 };
    });

    const result = await deliverWebhook({
      channel: webhookChannel(),
      payload,
      timeoutMs: 50,
      nodeEnv: "production",
      outboundPolicy: new OutboundPolicy({ nodeEnv: "production" }),
      requestImpl,
      attempts: 3,
      retryDelayMs: 30
    } as never);

    expect(result).toEqual({ status: "failed", responseStatus: null, errorMessage: "Webhook delivery timed out" });
    expect(requestImpl).toHaveBeenCalledOnce();
  });

  it("redacts URL and header secrets from webhook connector failures", async () => {
    const requestImpl = vi.fn(async () => {
      throw new Error("connect https://hooks.example.test/private?token=url-secret X-Sigmon-Secret=header-secret");
    });

    const result = await deliverWebhook({
      channel: webhookChannel({
        secretHeaderName: "X-Sigmon-Secret",
        secretHeaderValue: "header-secret",
        hasSecret: true
      }),
      payload,
      timeoutMs: 500,
      nodeEnv: "production",
      outboundPolicy: new OutboundPolicy({ nodeEnv: "production" }),
      requestImpl
    } as never);

    expect(result.errorMessage).toBe("Webhook request failed");
    expect(result.errorMessage).not.toContain("private");
    expect(result.errorMessage).not.toContain("url-secret");
    expect(result.errorMessage).not.toContain("header-secret");
  });

  it("routes monitors through the shared bounded connector without a DNS preflight", async () => {
    const resolveHostname = vi.fn(async () => {
      throw new Error("preflight must not run");
    });
    const requestImpl = vi.fn(async () => ({ status: 200, body: "ok", latencyMs: 12 }));
    const policy = new OutboundPolicy({ nodeEnv: "production" });

    const result = await checkHttpMonitor({
      monitor: task4HttpMonitor({ url: "http://public.example.test/health" }),
      timeoutMs: 500,
      outboundPolicy: policy,
      resolveHostname,
      requestImpl
    } as never);

    expect(result).toEqual({ status: "success", latencyMs: 12, responseStatus: 200, errorMessage: null });
    expect(resolveHostname).not.toHaveBeenCalled();
    expect(requestImpl).toHaveBeenCalledWith(
      expect.objectContaining({ policy, maxResponseBytes: 65_536, redirectLimit: 0 })
    );
  });
});

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe("processTelemetryJob", () => {
  it("redacts feedback URLs from a raw queued payload created by an old SDK", async () => {
    const writer = createWriter();
    const job: TelemetryJobPayload = {
      kind: "feedback",
      id: "fbk_1",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        message: "Export wording is unclear",
        page_url: "https://app.test/reports?tab=exports#details",
        path: "/reports?tab=exports#details"
      }
    };

    await processTelemetryJob(job, writer);

    expect(writer.insertFeedbackItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "fbk_1",
        pageUrl: "https://app.test/reports?tab=%5BREDACTED%5D",
        path: "/reports?tab=%5BREDACTED%5D"
      })
    );
  });

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
        replay_id: "rpl_checkout_1",
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
        replayId: "rpl_checkout_1",
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

  it("sanitizes and persists survey response jobs", async () => {
    const writer = createWriter();
    const job: TelemetryJobPayload = {
      kind: "survey_response",
      id: "srs_1",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        survey_id: "srv_1",
        actor_type: "user",
        actor_id: "usr_1",
        user_id: "usr_1",
        tenant_id: "tenant_1",
        session_id: "sess_1",
        timestamp: "2026-01-01T00:00:00.000Z",
        answers: {
          satisfaction: 5,
          comment: "great",
          password: "secret"
        },
        metadata: {
          token: "secret"
        }
      }
    };

    await processTelemetryJob(job, writer);

    expect(writer.insertSurveyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "srs_1",
        projectId: "prj_1",
        environmentId: "env_1",
        surveyId: "srv_1",
        actorType: "user",
        actorId: "usr_1",
        userId: "usr_1",
        tenantId: "tenant_1",
        sessionId: "sess_1",
        answers: expect.objectContaining({
          satisfaction: 5,
          comment: "great",
          password: "[REDACTED]"
        }),
        metadata: expect.objectContaining({ token: "[REDACTED]" }),
        submittedAt: new Date("2026-01-01T00:00:00.000Z")
      })
    );
  });

  it("applies data governance rules before persisting event jobs", async () => {
    const writer = createWriter();
    vi.mocked(writer.getDataGovernancePolicy!).mockResolvedValue({
      projectId: "prj_1",
      environmentId: "env_1",
      retentionPolicy: {},
      propertyRules: [
        { target: "event.properties", path: "email", action: "mask" },
        { target: "event.properties", path: "billing.card", action: "block" },
        { target: "metadata", path: "headers.authorization", action: "block" }
      ],
      updatedByUserId: null,
      createdAt: new Date(0),
      updatedAt: new Date(0)
    });
    const job: TelemetryJobPayload = {
      kind: "event",
      id: "evt_governance",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        timestamp: "2026-01-01T00:00:00.000Z",
        metadata: {
          headers: {
            authorization: "Bearer secret",
            accept: "json"
          }
        },
        name: "checkout.started",
        properties: {
          email: "admin@example.com",
          billing: {
            card: "4242",
            plan: "team"
          }
        }
      }
    };

    await processTelemetryJob(job, writer);

    expect(writer.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { headers: { accept: "json" } },
        properties: {
          email: "[REDACTED]",
          billing: { plan: "team" }
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
        replay_id: "rpl_1",
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
        replayId: "rpl_1",
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

  it("persists runtime profile jobs", async () => {
    const writer = createWriter();
    const job: TelemetryJobPayload = {
      kind: "profile",
      id: "prf_1",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        timestamp: "2026-05-11T12:00:00.000Z",
        trace_id: "trace_1",
        name: "worker.tick",
        kind: "cpu",
        runtime: "node",
        started_at: "2026-05-11T12:00:00.000Z",
        duration_ms: 120,
        sample_count: 2,
        top_functions: [{ function_name: "tick", self_time_ms: 14, sample_count: 2 }],
        summary: { token: "secret" }
      }
    };

    await processTelemetryJob(job, writer);

    expect(writer.insertProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "prf_1",
        traceId: "trace_1",
        name: "worker.tick",
        kind: "cpu",
        runtime: "node",
        durationMs: 120,
        sampleCount: 2,
        topFunctions: [expect.objectContaining({ functionName: "tick", selfTimeMs: 14, sampleCount: 2 })],
        summary: { token: "[REDACTED]" }
      })
    );
  });

  it("persists privacy-safe click map jobs", async () => {
    const writer = createWriter();
    const job: TelemetryJobPayload = {
      kind: "click",
      id: "clk_1",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        timestamp: "2026-05-11T12:00:00.000Z",
        session_id: "sess_1",
        source: "web",
        metadata: { cookie: "session=secret" },
        route: "/checkout",
        selector: "[data-sigmon-id=\"pay\"]",
        element_tag: "button",
        element_role: "button",
        x: 0.25,
        y: 0.75,
        viewport_width: 1440,
        viewport_height: 900,
        scroll_x: 0,
        scroll_y: 320,
        masked: true
      }
    };

    await processTelemetryJob(job, writer);

    expect(writer.insertClickEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "clk_1",
        projectId: "prj_1",
        environmentId: "env_1",
        sessionId: "sess_1",
        route: "/checkout",
        selector: "[data-sigmon-id=\"pay\"]",
        elementTag: "button",
        elementRole: "button",
        x: 0.25,
        y: 0.75,
        viewportWidth: 1440,
        viewportHeight: 900,
        scrollX: 0,
        scrollY: 320,
        masked: true,
        metadata: { cookie: "[REDACTED]" }
      })
    );
  });

  it("persists masked session replay jobs", async () => {
    const writer = createWriter();
    const job: TelemetryJobPayload = {
      kind: "replay",
      id: "rpl_job_1",
      projectId: "prj_1",
      environmentId: "env_1",
      payload: {
        timestamp: "2026-05-11T12:00:00.000Z",
        session_id: "sess_1",
        source: "web",
        metadata: { authorization: "Bearer secret" },
        replay_id: "rpl_1",
        route: "/checkout",
        error_id: "err_1",
        started_at: "2026-05-11T11:59:58.000Z",
        ended_at: "2026-05-11T12:00:03.000Z",
        duration_ms: 5000,
        masked: true,
        events: [
          {
            offset_ms: 200,
            type: "click",
            selector: '[data-sigmon-id="pay"]',
            data: { token: "secret" }
          }
        ]
      }
    };

    await processTelemetryJob(job, writer);

    expect(writer.insertSessionReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rpl_job_1",
        projectId: "prj_1",
        environmentId: "env_1",
        sessionId: "sess_1",
        replayId: "rpl_1",
        route: "/checkout",
        errorId: "err_1",
        startedAt: new Date("2026-05-11T11:59:58.000Z"),
        endedAt: new Date("2026-05-11T12:00:03.000Z"),
        durationMs: 5000,
        masked: true,
        metadata: { authorization: "[REDACTED]" },
        events: [expect.objectContaining({ offsetMs: 200, type: "click", data: { token: "[REDACTED]" } })]
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
        profilesDays: 30,
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
            webVitals: 0,
          profiles: 0,
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
        profilesDays: 30,
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
        profilesDays: 30,
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
          webVitals: 0,
          profiles: 0,
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
          profilesDays: 30,
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
                  webVitals: 0,
          profiles: 0,
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
        profilesDays: 30,
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
              webVitals: 0,
          profiles: 0,
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
        profilesDays: 30,
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
            webVitals: 0,
          profiles: 0,
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
        profilesDays: 30,
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
                webVitals: 0,
          profiles: 0,
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
          webVitals: 0,
          profiles: 0,
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
        profilesDays: 30,
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
            webVitals: 0,
          profiles: 0,
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
          webVitals: 0,
          profiles: 0,
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
          escalationChannelId: null,
          name: "Critical errors",
          type: "critical_errors",
          severity: "critical",
          windowMinutes: 10,
          threshold: "1",
          cooldownMinutes: 30,
          escalationMinutes: null,
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

  it("suppresses attributable alert events when the triggering error group is silenced", async () => {
    const now = new Date("2026-05-06T12:00:00.000Z");
    const eventInputs: unknown[] = [];
    const updates: unknown[] = [];

    const result = await runAlertEvaluationOnce({
      now: () => now,
      withLock: async (run) => ({ locked: true, result: await run() }),
      listActiveRules: async () => [
        {
          id: "rule_silenced",
          projectId: "prj_1",
          environmentId: "env_1",
          notificationChannelId: null,
          escalationChannelId: null,
          name: "Errors",
          type: "error_count",
          severity: "warning",
          windowMinutes: 10,
          threshold: "1",
          cooldownMinutes: 30,
          escalationMinutes: null,
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
      getNotificationChannel: async () => null,
      evaluateRule: async () => ({ observedValue: "4", errorGroupId: "egrp_silenced" }),
      isErrorGroupSilenced: async (input) => {
        expect(input).toEqual({ errorGroupId: "egrp_silenced", now });
        return true;
      },
      recordAlertEvent: async (input) => {
        eventInputs.push(input);
        return { id: "evt_suppressed" };
      },
      updateRuleEvaluation: async (input) => {
        updates.push(input);
      },
      deliver: async () => ({ status: "success", responseStatus: 204, errorMessage: null }),
      recordDelivery: async () => {}
    });

    expect(result).toEqual({ ran: true, skipped: false, evaluated: 1, triggered: 0 });
    expect(eventInputs).toEqual([]);
    expect(updates).toEqual([{ ruleId: "rule_silenced", evaluatedAt: now }]);
  });

  it("delivers due escalations once for unacknowledged alert events", async () => {
    const now = new Date("2026-05-06T12:10:00.000Z");
    const deliveries: unknown[] = [];
    const marked: unknown[] = [];
    const payloads: unknown[] = [];

    const result = await runAlertEvaluationOnce({
      now: () => now,
      withLock: async (run) => ({ locked: true, result: await run() }),
      listActiveRules: async () => [],
      getNotificationChannel: async () => ({
        id: "chn_escalation",
        name: "Escalation",
        type: "webhook",
        url: "https://hooks.example.com/escalation",
        emailRecipients: [],
        secretHeaderName: null,
        secretHeaderValue: null,
        hasSecret: false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        archivedAt: null
      }),
      evaluateRule: async () => ({ observedValue: "0" }),
      recordAlertEvent: async () => ({ id: "evt_new" }),
      updateRuleEvaluation: async () => undefined,
      deliver: async (_channel, payload) => {
        payloads.push(payload);
        return { status: "success", responseStatus: 202, errorMessage: null };
      },
      recordDelivery: async (input) => {
        deliveries.push(input);
      },
      listEscalationsDue: async () => [
        {
          id: "evt_due",
          ruleId: "rule_1",
          monitorId: null,
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
          metadata: { ruleType: "critical_errors" },
          acknowledgedAt: null,
          acknowledgedByUserId: null,
          acknowledgedByEmail: null,
          resolvedAt: null,
          resolvedByUserId: null,
          resolvedByEmail: null,
          snoozedUntil: null,
          triageNote: null,
          escalationDueAt: new Date("2026-05-06T12:05:00.000Z"),
          escalatedAt: null,
          createdAt: new Date("2026-05-06T12:00:00.000Z"),
          latestDeliveryStatus: "success",
          ruleNotificationChannelId: "chn_primary",
          ruleEscalationChannelId: "chn_escalation",
          ruleName: "Critical errors",
          ruleType: "critical_errors",
          ruleWindowMinutes: 10
        }
      ],
      markEscalated: async (id, escalatedAt) => {
        marked.push({ id, escalatedAt });
      }
    });

    expect(result).toEqual({ ran: true, skipped: false, evaluated: 0, triggered: 0 });
    expect(payloads).toEqual([
      expect.objectContaining({
        alertEventId: "evt_due",
        ruleId: "rule_1",
        ruleName: "Critical errors",
        message: expect.stringContaining("Escalation:")
      })
    ]);
    expect(deliveries).toEqual([
      expect.objectContaining({
        alertEventId: "evt_due",
        notificationChannelId: "chn_escalation",
        status: "success",
        responseStatus: 202
      })
    ]);
    expect(marked).toEqual([{ id: "evt_due", escalatedAt: now }]);
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
          escalationChannelId: null,
          name: "Errors",
          type: "error_count",
          severity: "warning",
          windowMinutes: 10,
          threshold: "1",
          cooldownMinutes: 30,
          escalationMinutes: null,
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
          escalationChannelId: null,
          name: "Critical errors",
          type: "critical_errors",
          severity: "critical",
          windowMinutes: 10,
          threshold: "1",
          cooldownMinutes: 30,
          escalationMinutes: null,
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
      requestImpl,
      retryDelayMs: 0
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

  it("retries transient webhook responses before recording success", async () => {
    const requestImpl = vi
      .fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 204 });
    const sleeps: number[] = [];

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
      requestImpl,
      retryDelayMs: 25,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      }
    });

    expect(result).toEqual({ status: "success", responseStatus: 204, errorMessage: null });
    expect(requestImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([25]);
  });

  it("retries transient webhook timeouts and records the final failure", async () => {
    const requestImpl = vi.fn(async () => {
      throw new Error("Webhook delivery timed out");
    });

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
      timeoutMs: 100,
      nodeEnv: "production",
      resolveHostname: resolvePublicHostname,
      requestImpl,
      attempts: 2,
      retryDelayMs: 0
    });

    expect(result).toEqual({
      status: "failed",
      responseStatus: null,
      errorMessage: "Webhook delivery timed out"
    });
    expect(requestImpl).toHaveBeenCalledTimes(2);
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
      requestImpl,
      retryDelayMs: 0
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
      const family = address.includes(":") ? 6 : 4;
      const requestLookup: LookupFunction = (_hostname, _options, callback) => {
        callback(null, [{ address, family }], family);
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
        requestLookup
      });

      expect(result, address).toEqual({
        status: "failed",
        responseStatus: null,
        errorMessage: "unsafe webhook target"
      });
    }
  });

  it("does not send a development request when a hostname resolves to a private address", async () => {
    const requestLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, [{ address: "169.254.169.254", family: 4 }], 4);
    };

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
      requestLookup
    });

    expect(result).toEqual({
      status: "failed",
      responseStatus: null,
      errorMessage: "unsafe webhook target"
    });
  });

  it("does not send a development request when a hostname resolves to an unsafe IPv4-embedded IPv6 address", async () => {
    const requestLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, [{ address: "64:ff9b::a9fe:a9fe", family: 6 }], 6);
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
      requestLookup
    });

    expect(result).toEqual({
      status: "failed",
      responseStatus: null,
      errorMessage: "unsafe webhook target"
    });
  });

  it("does not send a production request when hostname DNS resolution fails", async () => {
    const requestLookup: LookupFunction = (_hostname, _options, callback) => {
      const error = Object.assign(new Error("lookup failed"), { code: "ENOTFOUND" });
      callback(error, [], 0);
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
      requestLookup
    });

    expect(result).toEqual({
      status: "failed",
      responseStatus: null,
      errorMessage: "Webhook DNS resolution failed"
    });
  });

  it("does not retry permanent connection-time DNS failures", async () => {
    const error = new Error("host not found") as NodeJS.ErrnoException;
    error.code = "ENOTFOUND";
    const requestImpl = vi.fn(async () => {
      throw error;
    });

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
      requestImpl,
      attempts: 3,
      retryDelayMs: 0
    });

    expect(result).toEqual({
      status: "failed",
      responseStatus: null,
      errorMessage: "Webhook DNS resolution failed"
    });
    expect(requestImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry deterministic webhook request construction errors", async () => {
    const error = new Error("Invalid character in header content") as NodeJS.ErrnoException;
    error.code = "ERR_INVALID_CHAR";
    const requestImpl = vi.fn(async () => {
      throw error;
    });

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
      requestImpl,
      attempts: 3,
      retryDelayMs: 0
    });

    expect(result).toEqual({
      status: "failed",
      responseStatus: null,
      errorMessage: "Webhook request failed"
    });
    expect(requestImpl).toHaveBeenCalledTimes(1);
  });

  it("blocks production delivery when connection-time DNS rebinds to a private address", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const requestLookup: LookupFunction = (hostname, _options, callback) => {
      expect(hostname).toBe("hooks.example.com");
      callback(null, [{ address: "169.254.169.254", family: 4 }], 4);
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
      callback(null, [{ address: "127.0.0.1", family: 4 }], 4);
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

  it("sends the raw alert payload unchanged for generic webhook channels (regression)", async () => {
    const requestImpl = vi.fn(async () => ({ status: 204 }));

    await deliverWebhook({
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
      requestImpl,
      retryDelayMs: 0
    });

    expect(requestImpl).toHaveBeenCalledWith(expect.objectContaining({ body: JSON.stringify(payload) }));
  });

  it("uses the explicitly resolved Slack URL only at delivery and formats the message", async () => {
    const requestImpl = vi.fn(async () => ({ status: 204 }));

    await deliverWebhook({
      channel: {
        id: "chn_slack",
        name: "Slack",
        type: "slack",
        url: "https://hooks.slack.com/services/T0/xyz",
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
      requestImpl,
      retryDelayMs: 0
    });

    expect(requestImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: new URL("https://hooks.slack.com/services/T0/xyz"),
        body: JSON.stringify(toSlackPayload(payload))
      })
    );
  });

  it("formats the request body as a Discord embed for discord channels", async () => {
    const requestImpl = vi.fn(async () => ({ status: 204 }));

    await deliverWebhook({
      channel: {
        id: "chn_discord",
        name: "Discord",
        type: "discord",
        url: "https://discord.com/api/webhooks/1/token",
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
      requestImpl,
      retryDelayMs: 0
    });

    expect(requestImpl).toHaveBeenCalledWith(
      expect.objectContaining({ body: JSON.stringify(toDiscordPayload(payload)) })
    );
  });
});

describe("toSlackPayload / toDiscordPayload", () => {
  const payload = {
    alertEventId: "evt_1",
    ruleId: "rule_1",
    ruleName: "Errors",
    ruleType: "error_count" as const,
    severity: "critical" as const,
    projectId: "prj_1",
    environmentId: "env_1",
    triggeredAt: "2026-05-06T12:00:00.000Z",
    window: { from: "2026-05-06T11:50:00.000Z", to: "2026-05-06T12:00:00.000Z", minutes: 10 },
    observedValue: "2",
    threshold: "1",
    message: "Errors threshold reached: 2 >= 1",
    sigmon: { source: "sigmon" as const }
  };

  it("builds a Slack message with text and a mrkdwn section block", () => {
    const slackPayload = toSlackPayload(payload);

    expect(slackPayload.text).toContain(payload.ruleName);
    expect(slackPayload.text).toContain(payload.message);
    expect(slackPayload.text).toContain("CRITICAL");
    expect(slackPayload.blocks[0]).toMatchObject({
      type: "section",
      text: { type: "mrkdwn" }
    });
  });

  it("builds a Discord payload with a severity-colored embed", () => {
    const discordPayload = toDiscordPayload(payload);

    expect(discordPayload.embeds).toHaveLength(1);
    expect(discordPayload.embeds[0]).toMatchObject({
      title: payload.ruleName,
      description: payload.message,
      timestamp: payload.triggeredAt
    });
    expect(discordPayload.embeds[0].color).toBe(0xe01e5a);
  });

  it("prefixes escalation messages with 'Escalation:' in both formats", () => {
    const escalationPayload = { ...payload, message: `Escalation: ${payload.message} (channel chn_1)` };

    expect(toSlackPayload(escalationPayload).text).toContain("Escalation:");
    expect(toDiscordPayload(escalationPayload).embeds[0].description).toContain("Escalation:");
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
        subject: expect.stringContaining("Sigmon"),
        text: expect.stringContaining("Errors threshold reached"),
        html: expect.stringContaining("Errors threshold reached")
      })
    );
  });

  it("sends an HTML body without a console link when publicEndpoint is not configured", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "msg_1" });
    await deliverEmail({
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

    const call = sendMail.mock.calls[0][0];
    expect(call.html).toContain("<table");
    expect(call.html).not.toContain("View in Sigmon");
    expect(call.text).not.toContain("View in Sigmon");
  });

  it("includes a deep link to the console when publicEndpoint is configured", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "msg_1" });
    await deliverEmail({
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
      transportFactory: () => ({ sendMail }) as never,
      publicEndpoint: "https://sigmon.example.com/"
    });

    const call = sendMail.mock.calls[0][0];
    const expectedUrl = "https://sigmon.example.com/console#/alerts/evt_1";
    expect(call.text).toContain(expectedUrl);
    expect(call.html).toContain(expectedUrl);
    expect(call.html).toContain("View in Sigmon");
  });

  it("escapes HTML-sensitive characters in the message body", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "msg_1" });
    await deliverEmail({
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
      payload: { ...alertPayload(), message: `<script>alert("x")</script>` },
      timeoutMs: 2500,
      transportFactory: () => ({ sendMail }) as never
    });

    const call = sendMail.mock.calls[0][0];
    expect(call.html).not.toContain("<script>");
    expect(call.html).toContain("&lt;script&gt;");
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
