// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemHealthResponse, SystemHealthSampleResponse } from "../../api/types";
import { buildSystemVM, useSystemHealth } from "./useSystemHealth";

const NOW = Date.UTC(2026, 5, 23, 12, 0, 0); // 2026-06-23T12:00:00Z

function health(over: Partial<SystemHealthResponse> = {}): SystemHealthResponse {
  return {
    generatedAt: "2026-06-23T12:00:00.000Z",
    status: "healthy",
    services: {
      api: { status: "healthy", uptimeSeconds: 7530 }, // 2h 5m
      postgres: { status: "healthy", latencyMs: 12 },
      redis: { status: "healthy", latencyMs: 3 },
      worker: { status: "healthy", expected: true, role: "queue", lastHeartbeatAt: "2026-06-23T11:59:30.000Z" },
      scheduler: { status: "healthy", expected: true, role: "scheduler", lastHeartbeatAt: "2026-06-23T11:59:00.000Z" },
    },
    deployment: {} as never,
    queues: {
      telemetry: { status: "healthy", errorMessage: null, waiting: 2, active: 1, completed: 31000, failed: 0, delayed: 0, deadLettered: 0 },
    },
    ingestion: {} as never,
    retention: {
      enabled: true,
      intervalMinutes: 60,
      lastRun: {
        id: "r1", status: "success", startedAt: "2026-06-23T11:48:00.000Z", finishedAt: "2026-06-23T11:48:00.000Z",
        deleted: { events: 120, errors: 4, traces: 50, spans: 200, llmCalls: 9, webVitals: 0, profiles: 0, breadcrumbs: 300, deadLetterJobs: 2, sourceMapArtifacts: 0, sourceMapFiles: 0 },
        errorMessage: null,
      },
      policy: { eventsDays: 30, errorsDays: 90, tracesDays: 14, spansDays: 14, llmCallsDays: 60, profilesDays: 30, breadcrumbsDays: 7, deadLetterJobsDays: 30, sourceMapsEnabled: true, sourceMapsDays: 30, sourceMapsBatchSize: 100 },
    },
    backups: {
      enabled: true, intervalHours: 24, retentionDays: 14, s3Enabled: true, stale: false,
      latestSuccess: { id: "b1", status: "success", trigger: "scheduled", startedAt: "2026-06-23T06:00:00.000Z", finishedAt: "2026-06-23T06:00:00.000Z", filename: "backup-2026-06-23.sql.gz", sizeBytes: 1572864, s3Bucket: "b", s3Key: "k", errorMessage: null },
      latestFailure: null,
    },
    ...over,
  };
}

function sample(over: Partial<SystemHealthSampleResponse> = {}): SystemHealthSampleResponse {
  return { capturedAt: "2026-06-23T11:00:00.000Z", postgresLatencyMs: 10, redisLatencyMs: 2, queueWaiting: 1, queueActive: 0, queueFailed: 0, ...over };
}

const HISTORY = [sample({ postgresLatencyMs: 10, redisLatencyMs: 2, queueActive: 0 }), sample({ postgresLatencyMs: 14, redisLatencyMs: 3, queueActive: 2 })];

describe("buildSystemVM — header", () => {
  it("maps healthy -> ok Operational", () => {
    expect(buildSystemVM(health(), HISTORY, NOW).header).toEqual({ statusTone: "ok", statusLabel: "Operational" });
  });
  it("maps degraded -> warn Degraded", () => {
    expect(buildSystemVM(health({ status: "degraded" }), HISTORY, NOW).header).toEqual({ statusTone: "warn", statusLabel: "Degraded" });
  });
  it("maps unhealthy -> critical Unhealthy", () => {
    expect(buildSystemVM(health({ status: "unhealthy" }), HISTORY, NOW).header).toEqual({ statusTone: "critical", statusLabel: "Unhealthy" });
  });
});

describe("buildSystemVM — services", () => {
  it("orders API, Worker, Scheduler, Postgres, Redis with real meta", () => {
    const s = buildSystemVM(health(), HISTORY, NOW).services;
    expect(s.map((c) => c.name)).toEqual(["API", "Worker", "Scheduler", "Postgres", "Redis"]);
    expect(s[0].meta).toBe("uptime 2h 5m");
    expect(s[3].meta).toBe("latency 12ms");
    expect(s[1].meta).toBe("queue · heartbeat 30s ago");
  });
  it("renders null latency as em dash", () => {
    const s = buildSystemVM(health({ services: { ...health().services, postgres: { status: "degraded", latencyMs: null } } }), HISTORY, NOW).services;
    expect(s[3].meta).toBe("latency —ms");
    expect(s[3].tone).toBe("warn");
  });
  it("treats expected:false worker as idle / not expected", () => {
    const s = buildSystemVM(health({ services: { ...health().services, worker: { status: "unhealthy", expected: false, role: null, lastHeartbeatAt: null } } }), HISTORY, NOW).services;
    expect(s[1].tone).toBe("idle");
    expect(s[1].statusLabel).toBe("not expected");
    expect(s[1].meta).toBe("— · heartbeat none");
  });
  it("sparks Postgres/Redis/Worker from history; API/Scheduler null", () => {
    const s = buildSystemVM(health(), HISTORY, NOW).services;
    expect(s[0].spark).toBeNull(); // API
    expect(s[2].spark).toBeNull(); // Scheduler
    expect(s[1].spark).toEqual([0, 2]); // Worker queueActive
    expect(s[3].spark).toEqual([10, 14]); // Postgres latency
    expect(s[4].spark).toEqual([2, 3]); // Redis latency
  });
  it("returns null spark when history empty", () => {
    expect(buildSystemVM(health(), [], NOW).services[3].spark).toBeNull();
  });
  it("returns null spark when every point is null", () => {
    const allNull = [sample({ postgresLatencyMs: null }), sample({ postgresLatencyMs: null })];
    expect(buildSystemVM(health(), allNull, NOW).services[3].spark).toBeNull();
  });
});

describe("buildSystemVM — banner (severity ordered)", () => {
  it("is null when everything is healthy", () => {
    expect(buildSystemVM(health(), HISTORY, NOW).banner).toBeNull();
  });
  it("flags an unhealthy service as critical", () => {
    const b = buildSystemVM(health({ services: { ...health().services, redis: { status: "unhealthy", latencyMs: null } } }), HISTORY, NOW).banner;
    expect(b).toEqual({ tone: "critical", title: "Redis unhealthy", detail: "Redis ping failed — cache and queue backing unavailable." });
  });
  it("flags a failed retention run as warn", () => {
    const r = health().retention;
    const b = buildSystemVM(health({ retention: { ...r, lastRun: { ...r.lastRun!, status: "failed", errorMessage: "disk full" } } }), HISTORY, NOW).banner;
    expect(b).toEqual({ tone: "warn", title: "Retention run failed", detail: "disk full" });
  });
  it("flags stale backups as warn", () => {
    const b = buildSystemVM(health({ backups: { ...health().backups, stale: true } }), HISTORY, NOW).banner;
    expect(b).toEqual({ tone: "warn", title: "Backups need attention", detail: "No recent successful backup." });
  });
  it("flags a degraded service as warn (after operational checks)", () => {
    const b = buildSystemVM(health({ services: { ...health().services, postgres: { status: "degraded", latencyMs: 900 } } }), HISTORY, NOW).banner;
    expect(b).toEqual({ tone: "warn", title: "Postgres degraded", detail: "Postgres is reporting degraded performance." });
  });
});

describe("buildSystemVM — queues / retention / backups", () => {
  it("maps the telemetry queue", () => {
    const q = buildSystemVM(health(), HISTORY, NOW).queues;
    expect(q).toEqual([{ name: "telemetry", waiting: 2, active: 1, completed: "31K", failed: 0, deadLettered: 0, tone: "ok" }]);
  });
  it("tones a queue with failures as warn", () => {
    const q = buildSystemVM(health({ queues: { telemetry: { status: "healthy", errorMessage: null, waiting: 0, active: 0, completed: 5, failed: 3, delayed: 0, deadLettered: 0 } } }), HISTORY, NOW).queues;
    expect(q[0]).toMatchObject({ failed: 3, tone: "warn" });
  });
  it("tones a queue with dead letters as warn", () => {
    const vm = buildSystemVM(
      health({ queues: { telemetry: { status: "degraded", errorMessage: null, waiting: 0, active: 0, completed: 5, failed: 0, delayed: 0, deadLettered: 2 } } }),
      HISTORY,
      NOW,
    );
    expect(vm.queues[0]).toMatchObject({ deadLettered: 2, tone: "warn" });
    expect(vm.banner).toEqual({
      tone: "warn",
      title: "Dead-letter jobs",
      detail: "telemetry queue has 2 dead-letter job(s) to inspect.",
    });
  });
  it("builds retention subLabel and deleted rows", () => {
    const r = buildSystemVM(health(), HISTORY, NOW).retention;
    expect(r.enabled).toBe(true);
    expect(r.subLabel).toBe("every 60m · last run 12m ago");
    expect(r.rows).toEqual([
      { label: "Events", retentionLabel: "30d", deleted: 120 },
      { label: "Errors", retentionLabel: "90d", deleted: 4 },
      { label: "Traces", retentionLabel: "14d", deleted: 50 },
      { label: "Spans", retentionLabel: "14d", deleted: 200 },
      { label: "LLM calls", retentionLabel: "60d", deleted: 9 },
      { label: "Breadcrumbs", retentionLabel: "7d", deleted: 300 },
      { label: "Dead letters", retentionLabel: "30d", deleted: 2 },
    ]);
  });
  it("shows disabled retention", () => {
    const r = buildSystemVM(health({ retention: { ...health().retention, enabled: false, lastRun: null } }), HISTORY, NOW).retention;
    expect(r.subLabel).toBe("disabled");
    expect(r.rows.every((row) => row.deleted === 0)).toBe(true);
  });
  it("builds backups latest + config subLabel", () => {
    const b = buildSystemVM(health(), HISTORY, NOW).backups;
    expect(b.subLabel).toBe("every 24h · keep 14d · S3 on");
    expect(b.latest).toEqual({ filename: "backup-2026-06-23.sql.gz", meta: "6h ago · 1.5 MB" });
    expect(b.failure).toBeNull();
    expect(b.stale).toBe(false);
  });
  it("surfaces a backup failure", () => {
    const b = buildSystemVM(health({ backups: { ...health().backups, latestSuccess: null, latestFailure: { id: "f1", status: "failed", trigger: "scheduled", startedAt: "2026-06-23T06:00:00.000Z", finishedAt: "2026-06-23T06:00:00.000Z", filename: "x", sizeBytes: null, s3Bucket: null, s3Key: null, errorMessage: "pg_dump failed" } } }), HISTORY, NOW).backups;
    expect(b.latest).toBeNull();
    expect(b.failure).toEqual({ meta: "6h ago · pg_dump failed" });
  });
});

describe("useSystemHealth hook", () => {
  function makeClient() {
    return {
      getSystemHealth: vi.fn().mockResolvedValue({ data: health() }),
      getSystemHealthHistory: vi.fn().mockResolvedValue({ data: HISTORY }),
      listDeadLetterJobs: vi.fn().mockResolvedValue({ deadLetterJobs: [] }),
      getDeadLetterJob: vi.fn(),
      listDeadLetterJobActions: vi.fn(),
      replayDeadLetterJob: vi.fn(),
      deleteDeadLetterJob: vi.fn(),
    };
  }
  it("loads and builds a VM from both fetches", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSystemHealth({ client }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.services).toHaveLength(5);
    expect(client.getSystemHealthHistory).toHaveBeenCalledWith({ limit: 48 });
  });
  it("reports error when a fetch rejects", async () => {
    const client = { getSystemHealth: vi.fn().mockRejectedValue(new Error("boom")), getSystemHealthHistory: vi.fn().mockResolvedValue({ data: [] }) };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useSystemHealth({ client }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });
});

describe("useSystemHealth hook — dead-letter queue", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeClient(over: Record<string, unknown> = {}) {
    return {
      getSystemHealth: vi.fn().mockResolvedValue({ data: health() }),
      getSystemHealthHistory: vi.fn().mockResolvedValue({ data: HISTORY }),
      listDeadLetterJobs: vi.fn().mockResolvedValue({
        deadLetterJobs: [
          { id: "dlj_1", projectId: null, environmentId: null, queueName: "telemetry", jobName: "event", payload: { a: 1 }, errorMessage: "boom", createdAt: "2026-06-23T11:00:00.000Z" },
        ],
      }),
      getDeadLetterJob: vi.fn(),
      listDeadLetterJobActions: vi.fn(),
      replayDeadLetterJob: vi.fn(),
      deleteDeadLetterJob: vi.fn(),
      ...over,
    };
  }

  it("loads dlq jobs alongside health and builds the VM", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSystemHealth({ client }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    await waitFor(() => expect(result.current.data?.dlq.status).toBe("ok"));
    expect(result.current.data?.dlq.jobs).toEqual([
      { id: "dlj_1", queueName: "telemetry", jobName: "event", errorMessage: "boom", ageLabel: "1h ago" },
    ]);
  });

  it("is tolerant to a dlq list failure — health still renders", async () => {
    const client = makeClient({ listDeadLetterJobs: vi.fn().mockRejectedValue(new Error("dlq down")) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useSystemHealth({ client }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    await waitFor(() => expect(result.current.data?.dlq.status).toBe("error"));
    expect(result.current.data?.services).toHaveLength(5);
  });

  it("treats a missing listDeadLetterJobs method as an empty, ok dlq block", async () => {
    const client = makeClient();
    delete (client as Record<string, unknown>).listDeadLetterJobs;
    const { result } = renderHook(() => useSystemHealth({ client }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.dlq).toEqual({ status: "ok", jobs: [] });
  });

  it("replays a dead-letter job and reloads afterward", async () => {
    const client = makeClient({ replayDeadLetterJob: vi.fn().mockResolvedValue({ replayed: true, id: "dlj_1" }) });
    const { result } = renderHook(() => useSystemHealth({ client }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    const callsBefore = client.getSystemHealth.mock.calls.length;

    const outcome = await result.current.replayDeadLetterJob("dlj_1");

    expect(outcome).toEqual({ ok: true });
    expect(client.replayDeadLetterJob).toHaveBeenCalledWith("dlj_1");
    await waitFor(() => expect(client.getSystemHealth.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("reports a failed replay without reloading", async () => {
    const client = makeClient({ replayDeadLetterJob: vi.fn().mockRejectedValue(new Error("nope")) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useSystemHealth({ client }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    const outcome = await result.current.replayDeadLetterJob("dlj_1");

    expect(outcome).toEqual({ ok: false, error: "Failed to replay the dead-letter job." });
  });

  it("deletes a dead-letter job and reloads afterward", async () => {
    const client = makeClient({ deleteDeadLetterJob: vi.fn().mockResolvedValue(undefined) });
    const { result } = renderHook(() => useSystemHealth({ client }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    const callsBefore = client.getSystemHealth.mock.calls.length;

    const outcome = await result.current.deleteDeadLetterJob("dlj_1");

    expect(outcome).toEqual({ ok: true });
    await waitFor(() => expect(client.getSystemHealth.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("returns an unavailable error when the client has no replay method", async () => {
    const client = makeClient();
    delete (client as Record<string, unknown>).replayDeadLetterJob;
    const { result } = renderHook(() => useSystemHealth({ client }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    const outcome = await result.current.replayDeadLetterJob("dlj_1");

    expect(outcome).toEqual({ ok: false, error: "Replay is not available in this deployment." });
  });

  it("loads job detail (payload + actions) on demand", async () => {
    const client = makeClient({
      getDeadLetterJob: vi.fn().mockResolvedValue({ deadLetterJob: { id: "dlj_1", payload: { big: "thing" } } }),
      listDeadLetterJobActions: vi.fn().mockResolvedValue({
        actions: [
          { id: "act_1", deadLetterJobId: "dlj_1", queueName: "telemetry", jobName: "event", action: "replayed", actorUserId: "u1", actorEmail: "ops@example.com", metadata: {}, createdAt: "2026-06-23T11:00:00.000Z" },
        ],
      }),
    });
    const { result } = renderHook(() => useSystemHealth({ client }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    const detail = await result.current.loadDeadLetterJobDetail("dlj_1");

    expect(detail).toEqual({
      payload: { big: "thing" },
      actions: [{ id: "act_1", action: "replayed", actorEmail: "ops@example.com", ageLabel: "1h ago" }],
    });
  });

  it("still returns the payload when the actions fetch fails", async () => {
    const client = makeClient({
      getDeadLetterJob: vi.fn().mockResolvedValue({ deadLetterJob: { id: "dlj_1", payload: { big: "thing" } } }),
      listDeadLetterJobActions: vi.fn().mockRejectedValue(new Error("actions down")),
    });
    const { result } = renderHook(() => useSystemHealth({ client }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    const detail = await result.current.loadDeadLetterJobDetail("dlj_1");

    expect(detail).toEqual({ payload: { big: "thing" }, actions: [] });
  });

  it("returns null detail when the job fetch fails", async () => {
    const client = makeClient({ getDeadLetterJob: vi.fn().mockRejectedValue(new Error("job down")) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useSystemHealth({ client }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    const detail = await result.current.loadDeadLetterJobDetail("dlj_1");

    expect(detail).toBeNull();
  });

  it("returns null detail when the client has no getDeadLetterJob method", async () => {
    const client = makeClient();
    delete (client as Record<string, unknown>).getDeadLetterJob;
    const { result } = renderHook(() => useSystemHealth({ client }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    const detail = await result.current.loadDeadLetterJobDetail("dlj_1");

    expect(detail).toBeNull();
  });
});
