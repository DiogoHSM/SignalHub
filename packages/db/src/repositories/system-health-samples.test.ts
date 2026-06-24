import { describe, expect, it, vi } from "vitest";
import {
  listSystemHealthSamples,
  pruneSystemHealthSamples,
  recordSystemHealthSample,
  type SystemHealthSampleRecord
} from "./system-health-samples.js";

const CAPTURED_AT = new Date("2026-06-23T12:00:00.000Z");

function makeRow(overrides: Partial<{
  id: string;
  captured_at: Date;
  postgres_latency_ms: number | null;
  redis_latency_ms: number | null;
  queue_waiting: number;
  queue_active: number;
  queue_failed: number;
}> = {}) {
  return {
    id: "sample-1",
    captured_at: CAPTURED_AT,
    postgres_latency_ms: 2,
    redis_latency_ms: 3,
    queue_waiting: 4,
    queue_active: 5,
    queue_failed: 6,
    ...overrides
  };
}

describe("recordSystemHealthSample", () => {
  it("inserts the sample and maps the returned row to camelCase", async () => {
    const executeTakeFirstOrThrow = vi.fn().mockResolvedValue(makeRow());
    const values = vi.fn().mockReturnValue({ returningAll: vi.fn().mockReturnThis(), executeTakeFirstOrThrow });
    const insertInto = vi.fn().mockReturnValue({ values });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { insertInto } as any;

    const record = await recordSystemHealthSample(db, {
      capturedAt: CAPTURED_AT,
      postgresLatencyMs: 2,
      redisLatencyMs: 3,
      queueWaiting: 4,
      queueActive: 5,
      queueFailed: 6
    });

    expect(insertInto).toHaveBeenCalledWith("system_health_samples");
    expect(values).toHaveBeenCalledWith({
      captured_at: CAPTURED_AT,
      postgres_latency_ms: 2,
      redis_latency_ms: 3,
      queue_waiting: 4,
      queue_active: 5,
      queue_failed: 6
    });
    const expected: SystemHealthSampleRecord = {
      id: "sample-1",
      capturedAt: CAPTURED_AT,
      postgresLatencyMs: 2,
      redisLatencyMs: 3,
      queueWaiting: 4,
      queueActive: 5,
      queueFailed: 6
    };
    expect(record).toEqual(expected);
  });

  it("persists null latencies", async () => {
    const executeTakeFirstOrThrow = vi
      .fn()
      .mockResolvedValue(makeRow({ postgres_latency_ms: null, redis_latency_ms: null }));
    const values = vi.fn().mockReturnValue({ returningAll: vi.fn().mockReturnThis(), executeTakeFirstOrThrow });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { insertInto: vi.fn().mockReturnValue({ values }) } as any;

    const record = await recordSystemHealthSample(db, {
      capturedAt: CAPTURED_AT,
      postgresLatencyMs: null,
      redisLatencyMs: null,
      queueWaiting: 0,
      queueActive: 0,
      queueFailed: 0
    });

    expect(record.postgresLatencyMs).toBeNull();
    expect(record.redisLatencyMs).toBeNull();
  });
});

describe("pruneSystemHealthSamples", () => {
  it("deletes rows older than the cutoff and returns the deleted count", async () => {
    const execute = vi.fn().mockResolvedValue([{ numDeletedRows: 7n }]);
    const where = vi.fn().mockReturnValue({ execute });
    const deleteFrom = vi.fn().mockReturnValue({ where });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { deleteFrom } as any;

    const deleted = await pruneSystemHealthSamples(db, { cutoff: CAPTURED_AT });

    expect(deleteFrom).toHaveBeenCalledWith("system_health_samples");
    expect(where).toHaveBeenCalledWith("captured_at", "<", CAPTURED_AT);
    expect(deleted).toBe(7);
  });
});

describe("listSystemHealthSamples", () => {
  it("selects the latest N rows and returns them oldest -> newest", async () => {
    // repo selects desc (newest first), then reverses in JS
    const rows = [
      makeRow({ id: "newest", captured_at: new Date("2026-06-23T12:10:00.000Z") }),
      makeRow({ id: "middle", captured_at: new Date("2026-06-23T12:05:00.000Z") }),
      makeRow({ id: "oldest", captured_at: new Date("2026-06-23T12:00:00.000Z") })
    ];
    const execute = vi.fn().mockResolvedValue(rows);
    const limit = vi.fn().mockReturnValue({ execute });
    const orderByDesc2 = vi.fn().mockReturnValue({ limit });
    const orderByDesc1 = vi.fn().mockReturnValue({ orderBy: orderByDesc2 });
    const selectAll = vi.fn().mockReturnValue({ orderBy: orderByDesc1 });
    const selectFrom = vi.fn().mockReturnValue({ selectAll });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { selectFrom } as any;

    const result = await listSystemHealthSamples(db, { limit: 60 });

    expect(selectFrom).toHaveBeenCalledWith("system_health_samples");
    expect(orderByDesc1).toHaveBeenCalledWith("captured_at", "desc");
    expect(orderByDesc2).toHaveBeenCalledWith("id", "desc");
    expect(limit).toHaveBeenCalledWith(60);
    expect(result.map((r) => r.id)).toEqual(["oldest", "middle", "newest"]);
  });
});
