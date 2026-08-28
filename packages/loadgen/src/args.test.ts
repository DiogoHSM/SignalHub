import { describe, expect, it } from "vitest";
import { parseDurationMs, parseRunArgs } from "./args.js";

describe("parseDurationMs", () => {
  it.each([
    ["30m", 30 * 60_000],
    ["2h", 2 * 3_600_000],
    ["7d", 7 * 86_400_000]
  ])("parses %s", (input, expectedMs) => {
    expect(parseDurationMs(input)).toBe(expectedMs);
  });

  it("throws on an invalid duration string", () => {
    expect(() => parseDurationMs("banana")).toThrow(/invalid duration/);
  });
});

describe("parseRunArgs", () => {
  it("parses --config, --profile, --projects, --live", () => {
    const args = parseRunArgs(["run", "--config", ".loadgen.json", "--profile", "ecommerce", "--projects", "3", "--live", "2h"]);
    expect(args).toEqual({ config: ".loadgen.json", profile: "ecommerce", projects: 3, backfillMs: 0, liveMs: 2 * 3_600_000 });
  });

  it("parses --backfill and --live combined", () => {
    const args = parseRunArgs(["run", "--config", ".loadgen.json", "--profile", "saas-b2b", "--projects", "2", "--backfill", "3d", "--live", "1h"]);
    expect(args).toEqual({ config: ".loadgen.json", profile: "saas-b2b", projects: 2, backfillMs: 3 * 86_400_000, liveMs: 3_600_000 });
  });

  it("defaults --config to .loadgen.json when omitted", () => {
    const args = parseRunArgs(["run", "--profile", "fintech", "--projects", "1", "--backfill", "1d"]);
    expect(args.config).toBe(".loadgen.json");
  });

  it("throws when neither --backfill nor --live is given", () => {
    expect(() => parseRunArgs(["run", "--profile", "ecommerce", "--projects", "1"])).toThrow(/backfill|live/);
  });

  it("throws when --profile is missing", () => {
    expect(() => parseRunArgs(["run", "--projects", "1", "--live", "1h"])).toThrow(/profile/);
  });
});
