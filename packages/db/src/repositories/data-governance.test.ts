import { describe, expect, it } from "vitest";

import { applyDataGovernanceRules } from "./data-governance.js";

describe("applyDataGovernanceRules", () => {
  it.each([
    ["omitted", undefined],
    ["null", null],
    ["string", "visible"],
    ["number", 42],
    ["boolean", false],
    ["array", ["visible", { nested: true }]]
  ])("preserves a %s JSON root instead of inventing an object", (_label, value) => {
    const governed = applyDataGovernanceRules(value, { propertyRules: [] }, "span.input");

    expect(governed).toEqual(value);
    if (value !== null && typeof value === "object") {
      expect(governed).not.toBe(value);
    }
  });

  it("still masks object paths without mutating the submitted object", () => {
    const value = { secret: "private", nested: { keep: true } };

    const governed = applyDataGovernanceRules(
      value,
      { propertyRules: [{ target: "span.input", path: "secret", action: "mask" }] },
      "span.input"
    );

    expect(governed).toEqual({ secret: "[REDACTED]", nested: { keep: true } });
    expect(value).toEqual({ secret: "private", nested: { keep: true } });
  });
});
