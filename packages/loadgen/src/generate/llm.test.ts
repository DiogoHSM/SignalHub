import { describe, expect, it } from "vitest";
import { generateLlmCallBeats } from "./llm.js";
import { createRng } from "../rng.js";
import type { ServiceDefinition } from "../types.js";

const service: ServiceDefinition = {
  name: "support-bot",
  role: "core",
  callsServices: [],
  eventsPerHour: 250,
  errorRatePercent: 0.5,
  tracesPerHour: 0,
  hasLlmCalls: true,
  llmCallsPerHour: 60
};

describe("generateLlmCallBeats", () => {
  it("generates one call per configured hourly rate when the multiplier is 1", () => {
    const beats = generateLlmCallBeats(service, 0, 0, 3_600_000, createRng(1), () => 1);
    expect(beats).toHaveLength(60);
  });

  it("emits more calls inside a cost-spike window", () => {
    const beats = generateLlmCallBeats(service, 0, 0, 3_600_000, createRng(1), (t) => (t >= 1_000_000 && t < 1_600_000 ? 8 : 1));
    const inside = beats.filter((beat) => beat.timestampMs >= 1_000_000 && beat.timestampMs < 1_600_000);
    const outside = beats.filter((beat) => beat.timestampMs < 1_000_000);
    expect(inside.length).toBeGreaterThan(outside.length);
  });

  it("stamps provider, model, and positive cost/token/latency fields", () => {
    const beats = generateLlmCallBeats(service, 1, 0, 60_000, createRng(1), () => 1);
    for (const beat of beats) {
      expect(beat.kind).toBe("llmCall");
      expect(beat.provider).toBe("openai");
      expect(beat.inputTokens).toBeGreaterThan(0);
      expect(beat.outputTokens).toBeGreaterThan(0);
      expect(beat.costUsd).toBeGreaterThan(0);
      expect(beat.latencyMs).toBeGreaterThan(0);
      expect(beat.status).toBe("success");
    }
  });

  it("returns nothing when the service has no LLM calls", () => {
    const beats = generateLlmCallBeats({ ...service, hasLlmCalls: false }, 0, 0, 3_600_000, createRng(1), () => 1);
    expect(beats).toEqual([]);
  });
});
