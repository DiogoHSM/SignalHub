import { describe, expect, it, vi } from "vitest";
import type { TelemetryJobPayload } from "@signal-hub/queues";
import { startHeartbeat } from "../src/heartbeat.js";
import { runRetentionOnce, startRetentionScheduler } from "../src/retention.js";
import { buildDeadLetterJobInput, processTelemetryJob, type TelemetryWriter } from "../src/telemetry-worker.js";

function createWriter(): TelemetryWriter {
  return {
    insertEvent: vi.fn(async () => undefined),
    insertError: vi.fn(async () => undefined),
    insertLlmCall: vi.fn(async () => undefined),
    insertTrace: vi.fn(async () => undefined),
    insertSpan: vi.fn(async () => undefined)
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
        llmCallsDays: 180
      },
      withLock: async (run) => {
        const result = await run({
          deleteExpiredTelemetry: async () => ({ events: 1, errors: 2, traces: 3, spans: 4, llmCalls: 5 })
        });
        calls.push("released");
        return { locked: true, result };
      },
      recordRetentionRun: async (input) => {
        expect(input.status).toBe("success");
        expect(input.deleted.events).toBe(1);
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
        llmCallsDays: 180
      },
      withLock: async () => ({ locked: false }),
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
        llmCallsDays: 180
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
      recordRetentionRun: async (input) => {
        expect(input.status).toBe("failed");
        expect(input.errorMessage).toBe("authorization: [REDACTED]");
        expect(input.deleted).toEqual({ events: 0, errors: 0, spans: 0, traces: 0, llmCalls: 0 });
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
          llmCallsDays: 180
      },
      withLock: async (run) => {
        try {
          const result = await run({
            deleteExpiredTelemetry: async () => {
              calls.push("deleted");
              return { events: 1, errors: 2, traces: 3, spans: 4, llmCalls: 5 };
            }
          });
          return { locked: true, result };
        } finally {
          calls.push("released");
        }
      },
      recordRetentionRun: async (input) => {
        calls.push(`recorded:${input.status}:${input.deleted.events}`);
        throw recordError;
        }
      })
    ).rejects.toThrow(recordError);

    expect(calls).toEqual(["deleted", "released", "recorded:success:1"]);
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
