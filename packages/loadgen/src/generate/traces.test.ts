import { describe, expect, it } from "vitest";
import { generateTraceBeats } from "./traces.js";
import { createRng } from "../rng.js";
import type { ServiceDefinition } from "../types.js";
import type { SpanBeat, TraceBeat } from "../types.js";

const service: ServiceDefinition = {
  name: "checkout",
  role: "core",
  callsServices: ["payments", "inventory"],
  eventsPerHour: 300,
  errorRatePercent: 2,
  tracesPerHour: 60,
  hasLlmCalls: false,
  llmCallsPerHour: 0
};

describe("generateTraceBeats", () => {
  it("emits one trace beat and one span beat per callee, per tick", () => {
    const beats = generateTraceBeats(service, 0, 0, 3_600_000, createRng(1));
    const traces = beats.filter((beat): beat is TraceBeat => beat.kind === "trace");
    const spans = beats.filter((beat): beat is SpanBeat => beat.kind === "span");

    expect(traces).toHaveLength(60);
    expect(spans).toHaveLength(60 * service.callsServices.length);
  });

  it("gives every span the same traceId as its parent trace, and only from declared callees", () => {
    const beats = generateTraceBeats(service, 0, 0, 60_000, createRng(1));
    const trace = beats.find((beat): beat is TraceBeat => beat.kind === "trace");
    const spans = beats.filter((beat): beat is SpanBeat => beat.kind === "span" && beat.traceId === trace?.traceId);

    expect(trace).toBeDefined();
    expect(spans).toHaveLength(2);
    expect(spans.map((span) => span.serviceName).sort()).toEqual(["inventory", "payments"]);
    for (const span of spans) {
      expect(span.traceId).toBe(trace!.traceId);
    }
  });

  it("gives a leaf service (no callees) traces with no spans", () => {
    const leaf: ServiceDefinition = { ...service, name: "payments", callsServices: [], tracesPerHour: 30 };
    const beats = generateTraceBeats(leaf, 0, 0, 3_600_000, createRng(1));
    expect(beats.every((beat) => beat.kind === "trace")).toBe(true);
    expect(beats).toHaveLength(30);
  });

  it("returns nothing when tracesPerHour is zero", () => {
    const beats = generateTraceBeats({ ...service, tracesPerHour: 0 }, 0, 0, 3_600_000, createRng(1));
    expect(beats).toEqual([]);
  });
});
