import { describe, expect, it } from "vitest";
import { generateTimeline } from "./timeline.js";
import { ECOMMERCE_PROFILE } from "./profiles/ecommerce.js";

describe("generateTimeline", () => {
  it("produces beats sorted ascending, all within [nowMs - backfillMs, nowMs + liveMs)", () => {
    const nowMs = 10_000_000;
    const timeline = generateTimeline({ profile: ECOMMERCE_PROFILE, projectCount: 1, backfillMs: 3_600_000, liveMs: 1_800_000, nowMs, seed: 1 });

    expect(timeline.beats.length).toBeGreaterThan(0);
    const timestamps = timeline.beats.map((beat) => beat.timestampMs);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    for (const beat of timeline.beats) {
      expect(beat.timestampMs).toBeGreaterThanOrEqual(nowMs - 3_600_000);
      expect(beat.timestampMs).toBeLessThan(nowMs + 1_800_000);
    }
  });

  it("is deterministic for a fixed seed", () => {
    const options = { profile: ECOMMERCE_PROFILE, projectCount: 2, backfillMs: 600_000, liveMs: 0, nowMs: 5_000_000, seed: 99 };
    const first = generateTimeline(options);
    const second = generateTimeline(options);
    expect(first).toEqual(second);
  });

  it("produces beats for every projectIndex from 0 to projectCount - 1", () => {
    const timeline = generateTimeline({ profile: ECOMMERCE_PROFILE, projectCount: 3, backfillMs: 600_000, liveMs: 0, nowMs: 1_000_000, seed: 1 });
    const projectIndexes = new Set(timeline.beats.map((beat) => beat.projectIndex));
    expect(projectIndexes).toEqual(new Set([0, 1, 2]));
  });

  it("includes incident windows in the output", () => {
    const timeline = generateTimeline({ profile: ECOMMERCE_PROFILE, projectCount: 1, backfillMs: 3_600_000, liveMs: 0, nowMs: 3_600_000, seed: 1 });
    expect(timeline.incidentWindows).toHaveLength(1);
    expect(timeline.incidentWindows[0].incidentKey).toBe("checkout_outage");
  });
});
