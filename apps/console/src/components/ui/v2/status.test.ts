import { describe, expect, it } from "vitest";
import { STATUS, sev, type Status } from "./status";

describe("status helpers", () => {
  it("maps each known status to its accent var", () => {
    expect(STATUS.ok.color).toBe("var(--accent)");
    expect(STATUS.critical.color).toBe("var(--sev-critical)");
    expect(STATUS.warning.label).toBe("Attention");
  });

  it("sev() falls back to idle for unknown input", () => {
    expect(sev("nope")).toBe(STATUS.idle);
    expect(sev("ok" satisfies Status)).toBe(STATUS.ok);
  });
});
