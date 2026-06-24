import { describe, expect, it, vi } from "vitest";
import {
  collectHealthSample,
  runHealthSampleOnce,
  startHealthSampleScheduler
} from "../src/system-health-samples.js";

const NOW = new Date("2026-06-23T12:00:00.000Z");

describe("collectHealthSample", () => {
  it("returns measured latencies and queue counts on success", async () => {
    const sample = await collectHealthSample({
      now: () => NOW,
      postgresPing: async () => undefined,
      redisPing: async () => "PONG",
      getQueueCounts: async () => ({ waiting: 4, active: 5, failed: 6 })
    });

    expect(sample.capturedAt).toEqual(NOW);
    expect(typeof sample.postgresLatencyMs).toBe("number");
    expect(typeof sample.redisLatencyMs).toBe("number");
    expect(sample.queueWaiting).toBe(4);
    expect(sample.queueActive).toBe(5);
    expect(sample.queueFailed).toBe(6);
  });

  it("uses null latency when a ping rejects and never throws", async () => {
    const sample = await collectHealthSample({
      now: () => NOW,
      postgresPing: async () => {
        throw new Error("postgres down");
      },
      redisPing: async () => {
        throw new Error("redis down");
      },
      getQueueCounts: async () => ({ waiting: 1, active: 2, failed: 3 })
    });

    expect(sample.postgresLatencyMs).toBeNull();
    expect(sample.redisLatencyMs).toBeNull();
    expect(sample.queueWaiting).toBe(1);
  });

  it("uses zero queue counts when the queue read rejects", async () => {
    const sample = await collectHealthSample({
      now: () => NOW,
      postgresPing: async () => undefined,
      redisPing: async () => "PONG",
      getQueueCounts: async () => {
        throw new Error("queue unavailable");
      }
    });

    expect(sample.queueWaiting).toBe(0);
    expect(sample.queueActive).toBe(0);
    expect(sample.queueFailed).toBe(0);
  });

  it("defaults missing queue count fields to zero", async () => {
    const sample = await collectHealthSample({
      now: () => NOW,
      postgresPing: async () => undefined,
      redisPing: async () => "PONG",
      getQueueCounts: async () => ({ waiting: 9 })
    });

    expect(sample.queueWaiting).toBe(9);
    expect(sample.queueActive).toBe(0);
    expect(sample.queueFailed).toBe(0);
  });
});

describe("runHealthSampleOnce", () => {
  it("records the collected sample then prunes with the retention cutoff", async () => {
    const collected = {
      capturedAt: NOW,
      postgresLatencyMs: 2,
      redisLatencyMs: 3,
      queueWaiting: 4,
      queueActive: 5,
      queueFailed: 6
    };
    const collect = vi.fn().mockResolvedValue(collected);
    const record = vi.fn().mockResolvedValue(undefined);
    const prune = vi.fn().mockResolvedValue(0);

    await runHealthSampleOnce({
      collect,
      record,
      prune,
      retentionHours: 48,
      now: () => NOW
    });

    expect(record).toHaveBeenCalledWith(collected);
    expect(prune).toHaveBeenCalledWith({
      cutoff: new Date(NOW.getTime() - 48 * 60 * 60 * 1000)
    });
    // record must run before prune
    expect(record.mock.invocationCallOrder[0]).toBeLessThan(prune.mock.invocationCallOrder[0]);
  });
});

describe("startHealthSampleScheduler", () => {
  it("runs once after startup and prevents overlapping runs", async () => {
    const callbacks: Array<() => void> = [];
    let resolveRun!: () => void;
    const activeRun = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    const runOnce = vi.fn(() => activeRun);
    const setTimeoutFn = vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    const setIntervalFn = vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return 2 as unknown as ReturnType<typeof setInterval>;
    });
    const clearTimeoutFn = vi.fn();
    const clearIntervalFn = vi.fn();

    const stop = startHealthSampleScheduler({
      intervalMinutes: 5,
      runOnce,
      setTimeoutFn,
      setIntervalFn,
      clearTimeoutFn,
      clearIntervalFn
    });

    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000);
    callbacks[0]();
    callbacks[1]();
    expect(runOnce).toHaveBeenCalledTimes(1);
    resolveRun();
    await stop();
    expect(clearTimeoutFn).toHaveBeenCalled();
    expect(clearIntervalFn).toHaveBeenCalled();
  });
});
