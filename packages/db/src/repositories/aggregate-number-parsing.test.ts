import { describe, expect, it } from "vitest";
import { __test as operationsQueryTest } from "./operations-query.js";
import { __test as telemetryQueryTest } from "./telemetry-query.js";

describe("aggregate numeric parsing", () => {
  it("keeps telemetry aggregates finite and inside the safe JavaScript number range", () => {
    expect(telemetryQueryTest.toNumber("42")).toBe(42);
    expect(telemetryQueryTest.toNumber(42n)).toBe(42);
    expect(telemetryQueryTest.toNumber("12.5")).toBe(12.5);
    expect(telemetryQueryTest.toNumber("Infinity")).toBe(0);
    expect(telemetryQueryTest.toNumber("9007199254740992")).toBe(0);
    expect(telemetryQueryTest.toNumber(9007199254740992n)).toBe(0);
    expect(telemetryQueryTest.toRoundedOrNull("12.5")).toBe(13);
    expect(telemetryQueryTest.toRoundedOrNull("Infinity")).toBeNull();
    expect(telemetryQueryTest.toRoundedOrNull("9007199254740992")).toBeNull();
  });

  it("keeps nullable operations aggregates finite and inside the safe JavaScript number range", () => {
    expect(operationsQueryTest.toNullableNumber(null)).toBeNull();
    expect(operationsQueryTest.toNullableNumber("12.5")).toBe(12.5);
    expect(operationsQueryTest.toNullableNumber("Infinity")).toBeNull();
    expect(operationsQueryTest.toNullableNumber("9007199254740992")).toBeNull();
    expect(operationsQueryTest.toNumber(9007199254740992n)).toBe(0);
  });
});
