import { describe, expect, it, vi } from "vitest";
import { dispatchBeat, runExecutor } from "./executor.js";
import type { Beat, IncidentWindow, Timeline } from "./types.js";
import type { SignalMonitorClient } from "@sigmon/sdk";

function createFakeClient(): SignalMonitorClient & {
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
  };

  return {
    calls,
    track: record("track"),
    assignExperiment: vi.fn(),
    evaluateFlag: vi.fn(),
    captureError: record("captureError"),
    breadcrumb: record("breadcrumb"),
    llm: record("llm"),
    trace: record("trace"),
    startTrace: vi.fn(),
    span: record("span"),
    webVital: vi.fn(),
    click: vi.fn(),
    replay: vi.fn(),
    profile: vi.fn(),
    submitSurvey: vi.fn(),
    feedback: vi.fn(),
    identify: vi.fn(),
    identifyUser: record("identifyUser"),
    identifyTenant: record("identifyTenant"),
    flush: vi.fn(async () => ({ sent: 1, failed: 0, retained: 0, dropped: 0 })),
    shutdown: vi.fn(async () => ({ sent: 0, failed: 0, retained: 0, dropped: 0 }))
  };
}

describe("dispatchBeat", () => {
  it("calls the matching client method for each beat kind", () => {
    const client = createFakeClient();
    const beats: Beat[] = [
      { kind: "event", timestampMs: 0, projectIndex: 0, serviceName: "checkout", name: "checkout.request", properties: {} },
      { kind: "error", timestampMs: 0, projectIndex: 0, serviceName: "checkout", message: "boom", severity: "error" },
      { kind: "trace", timestampMs: 0, projectIndex: 0, serviceName: "checkout", traceId: "trc_1", name: "checkout.handle", status: "success", durationMs: 50 },
      { kind: "span", timestampMs: 0, projectIndex: 0, serviceName: "payments", traceId: "trc_1", name: "payments.call", status: "success", durationMs: 20 },
      { kind: "llmCall", timestampMs: 0, projectIndex: 0, serviceName: "support-bot", provider: "openai", model: "gpt-5", inputTokens: 100, outputTokens: 50, costUsd: 0.01, latencyMs: 300, status: "success" },
      { kind: "identifyUser", timestampMs: 0, projectIndex: 0, serviceName: "checkout", userId: "user_alice", tenantId: "tenant_acme", traits: {} },
      { kind: "identifyTenant", timestampMs: 0, projectIndex: 0, serviceName: "checkout", tenantId: "tenant_acme", traits: {} },
      { kind: "breadcrumb", timestampMs: 0, projectIndex: 0, serviceName: "checkout", message: "navigating to checkout" }
    ];

    for (const beat of beats) {
      dispatchBeat(client, beat);
    }

    expect(client.calls.map((call) => call.method)).toEqual([
      "track", "captureError", "trace", "span", "llm", "identifyUser", "identifyTenant", "breadcrumb"
    ]);
  });
});

describe("runExecutor", () => {
  it("fires past-timestamped beats immediately (backfill) without sleeping", async () => {
    const client = createFakeClient();
    const nowMs = 1_000_000;
    const timeline: Timeline = {
      beats: [
        { kind: "event", timestampMs: nowMs - 500_000, projectIndex: 0, serviceName: "checkout", name: "checkout.request", properties: {} },
        { kind: "event", timestampMs: nowMs - 100_000, projectIndex: 0, serviceName: "checkout", name: "checkout.request", properties: {} }
      ],
      incidentWindows: []
    };
    const sleepImpl = vi.fn(async () => {});

    const result = await runExecutor({ timeline, projectClients: [client], nowMs, sleepImpl });

    expect(sleepImpl).not.toHaveBeenCalled();
    expect(client.calls.filter((call) => call.method === "track")).toHaveLength(2);
    expect(result.sent).toBeGreaterThan(0);
  });

  it("sleeps until each future beat's scheduled time before firing it (live)", async () => {
    const client = createFakeClient();
    const nowMs = 1_000_000;
    const timeline: Timeline = {
      beats: [{ kind: "event", timestampMs: nowMs + 5_000, projectIndex: 0, serviceName: "checkout", name: "checkout.request", properties: {} }],
      incidentWindows: []
    };
    const sleepImpl = vi.fn(async () => {});
    const nowImpl = vi.fn(() => nowMs);

    await runExecutor({ timeline, projectClients: [client], nowMs, sleepImpl, nowImpl });

    expect(sleepImpl).toHaveBeenCalledWith(5_000);
    expect(client.calls.some((call) => call.method === "track")).toBe(true);
  });

  it("calls onOutageStart then onOutageEnd for a live-portion incident window, and skips a fully-backfilled one", async () => {
    const client = createFakeClient();
    const nowMs = 1_000_000;
    const liveWindow: IncidentWindow = {
      startMs: nowMs + 1_000,
      endMs: nowMs + 2_000,
      projectIndex: 0,
      serviceName: "checkout",
      incidentKey: "checkout_outage",
      errorRateMultiplier: 15,
      llmCallMultiplier: 1,
      monitorKind: "http"
    };
    const backfilledWindow: IncidentWindow = {
      startMs: nowMs - 10_000,
      endMs: nowMs - 5_000,
      projectIndex: 0,
      serviceName: "checkout",
      incidentKey: "old_outage",
      errorRateMultiplier: 15,
      llmCallMultiplier: 1,
      monitorKind: "http"
    };
    const timeline: Timeline = { beats: [], incidentWindows: [liveWindow, backfilledWindow] };
    const sleepImpl = vi.fn(async () => {});
    const nowImpl = vi.fn(() => nowMs);
    const onOutageStart = vi.fn();
    const onOutageEnd = vi.fn();

    const result = await runExecutor({ timeline, projectClients: [client], nowMs, sleepImpl, nowImpl, onOutageStart, onOutageEnd });

    expect(onOutageStart).toHaveBeenCalledWith(liveWindow);
    expect(onOutageEnd).toHaveBeenCalledWith(liveWindow);
    expect(onOutageStart).not.toHaveBeenCalledWith(backfilledWindow);
    expect(result.skippedOutageWindows).toBe(1);
  });

  it("flushes backfill beats in batches bounded by backfillBatchSize", async () => {
    const client = createFakeClient();
    const nowMs = 1_000_000;
    const beats: Beat[] = Array.from({ length: 5 }, (_, i) => ({
      kind: "event" as const,
      timestampMs: nowMs - 100_000 + i,
      projectIndex: 0,
      serviceName: "checkout",
      name: "checkout.request",
      properties: {}
    }));
    const timeline: Timeline = { beats, incidentWindows: [] };

    await runExecutor({ timeline, projectClients: [client], nowMs, backfillBatchSize: 2, sleepImpl: vi.fn(async () => {}) });

    // 5 beats, batch size 2: mid-loop flush after beat 2 and after beat 4, plus 1 final flush = 3 calls
    expect(client.flush).toHaveBeenCalledTimes(3);
  });

  it("runs the beat loop and outage loop concurrently, not sequentially", async () => {
    const client = createFakeClient();
    const nowMs = 1_000_000;
    let releaseBeatWait: () => void = () => {};
    const beatWaitGate = new Promise<void>((resolve) => {
      releaseBeatWait = resolve;
    });

    const timeline: Timeline = {
      beats: [
        { kind: "event", timestampMs: nowMs + 999_999, projectIndex: 0, serviceName: "checkout", name: "checkout.request", properties: {} }
      ],
      incidentWindows: [
        {
          startMs: nowMs + 10,
          endMs: nowMs + 20,
          projectIndex: 0,
          serviceName: "checkout",
          incidentKey: "quick",
          errorRateMultiplier: 1,
          llmCallMultiplier: 1,
          monitorKind: "http"
        }
      ]
    };

    const onOutageStart = vi.fn();
    const onOutageEnd = vi.fn();
    const sleepImpl = vi.fn((ms: number) => {
      if (ms === 999_999) {
        return beatWaitGate;
      }
      return Promise.resolve();
    });

    const resultPromise = runExecutor({
      timeline,
      projectClients: [client],
      nowMs,
      sleepImpl,
      nowImpl: () => nowMs,
      onOutageStart,
      onOutageEnd
    });

    // Let pending microtasks run without ever resolving the beat loop's gate.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onOutageStart).toHaveBeenCalled();
    expect(onOutageEnd).toHaveBeenCalled();

    releaseBeatWait();
    await resultPromise;
  });
});
