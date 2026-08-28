import { describe, expect, it } from "vitest";
import { generateErrorBeats } from "./errors.js";
import { createRng } from "../rng.js";
import type { ServiceDefinition } from "../types.js";

const service: ServiceDefinition = {
  name: "checkout",
  role: "core",
  callsServices: [],
  eventsPerHour: 60,
  errorRatePercent: 10,
  tracesPerHour: 0,
  hasLlmCalls: false,
  llmCallsPerHour: 0
};

describe("generateErrorBeats", () => {
  it("generates baseline errors at eventsPerHour * errorRatePercent when the multiplier is always 1", () => {
    const beats = generateErrorBeats(service, 0, 0, 3_600_000, createRng(1), () => 1);
    // 60 events/hr * 10% = 6 errors/hr baseline
    expect(beats).toHaveLength(6);
  });

  it("emits more errors inside a window where the multiplier is elevated", () => {
    const beats = generateErrorBeats(service, 0, 0, 3_600_000, createRng(1), (t) => (t >= 1_000_000 && t < 2_000_000 ? 5 : 1));
    const insideSpike = beats.filter((beat) => beat.timestampMs >= 1_000_000 && beat.timestampMs < 2_000_000);
    const outsideSpike = beats.filter((beat) => beat.timestampMs < 1_000_000);
    expect(insideSpike.length).toBeGreaterThan(outsideSpike.length);
  });

  it("stamps kind, severity, projectIndex, and serviceName correctly", () => {
    const beats = generateErrorBeats(service, 3, 0, 60_000, createRng(1), () => 1);
    for (const beat of beats) {
      expect(beat).toMatchObject({ kind: "error", severity: "error", projectIndex: 3, serviceName: "checkout" });
    }
  });

  it("returns beats sorted ascending by timestamp", () => {
    const beats = generateErrorBeats(service, 0, 0, 3_600_000, createRng(1), (t) => (t >= 1_000_000 && t < 1_200_000 ? 8 : 1));
    const timestamps = beats.map((beat) => beat.timestampMs);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it("returns nothing when errorRatePercent is zero", () => {
    const beats = generateErrorBeats({ ...service, errorRatePercent: 0 }, 0, 0, 3_600_000, createRng(1), () => 1);
    expect(beats).toEqual([]);
  });
});
