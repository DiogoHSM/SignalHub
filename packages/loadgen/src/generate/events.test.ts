import { describe, expect, it } from "vitest";
import { generateEventBeats } from "./events.js";
import { createRng } from "../rng.js";
import type { ServiceDefinition } from "../types.js";

const service: ServiceDefinition = {
  name: "checkout",
  role: "core",
  callsServices: [],
  eventsPerHour: 60,
  errorRatePercent: 2,
  tracesPerHour: 0,
  hasLlmCalls: false,
  llmCallsPerHour: 0
};

describe("generateEventBeats", () => {
  it("generates one beat per configured hourly rate across a one-hour window", () => {
    const beats = generateEventBeats(service, 0, 0, 3_600_000, createRng(1));
    expect(beats).toHaveLength(60);
  });

  it("keeps every beat within the window and sorted ascending", () => {
    const beats = generateEventBeats(service, 0, 0, 3_600_000, createRng(1));
    for (const beat of beats) {
      expect(beat.timestampMs).toBeGreaterThanOrEqual(0);
      expect(beat.timestampMs).toBeLessThan(3_600_000);
    }
    const timestamps = beats.map((beat) => beat.timestampMs);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it("stamps projectIndex, serviceName, and event kind correctly", () => {
    const beats = generateEventBeats(service, 2, 0, 60_000, createRng(1));
    expect(beats[0]).toMatchObject({ kind: "event", projectIndex: 2, serviceName: "checkout", name: "checkout.request" });
  });

  it("returns nothing for a service with zero event rate", () => {
    const beats = generateEventBeats({ ...service, eventsPerHour: 0 }, 0, 0, 3_600_000, createRng(1));
    expect(beats).toEqual([]);
  });
});
