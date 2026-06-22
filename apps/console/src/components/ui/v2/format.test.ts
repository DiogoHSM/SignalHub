import { describe, expect, it } from "vitest";
import { formatCompact } from "./format";

describe("formatCompact", () => {
  it("formats numbers below 10,000 with locale separators", () => {
    expect(formatCompact(287)).toBe("287");
    expect(formatCompact(2481)).toBe("2,481");
    expect(formatCompact(9999)).toBe("9,999");
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(1)).toBe("1");
  });

  it("formats 10,000 as 10K (boundary: exactly at threshold)", () => {
    expect(formatCompact(10_000)).toBe("10K");
  });

  it("formats numbers in the 10K–<1M range with rounded K", () => {
    expect(formatCompact(31_000)).toBe("31K");
    expect(formatCompact(184_000)).toBe("184K");
    expect(formatCompact(14_000)).toBe("14K");
    expect(formatCompact(999_999)).toBe("1000K");
  });

  it("formats numbers at or above 1M with two decimal M", () => {
    expect(formatCompact(1_000_000)).toBe("1.00M");
    expect(formatCompact(4_820_000)).toBe("4.82M");
  });
});
