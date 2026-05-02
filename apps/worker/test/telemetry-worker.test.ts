import { describe, expect, it, vi } from "vitest";
import type { TelemetryJobPayload } from "@signal-hub/queues";
import { processTelemetryJob, type TelemetryWriter } from "../src/telemetry-worker.js";

function createWriter(): TelemetryWriter {
  return {
    insertEvent: vi.fn(async () => undefined),
    insertError: vi.fn(async () => undefined),
    insertLlmCall: vi.fn(async () => undefined),
    insertTrace: vi.fn(async () => undefined),
    insertSpan: vi.fn(async () => undefined)
  };
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
        error: "provider rejected request",
        input_preview: "user prompt",
        output_preview: "model output"
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
        error: "provider rejected request",
        inputPreview: "user prompt",
        outputPreview: "model output",
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
        timestamp: "2026-01-01T00:00:00.000Z",
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
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
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
        timestamp: "2026-01-01T00:00:00.000Z",
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
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
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
});
