import { describe, expect, it } from "vitest";
import { generateBreadcrumbBeats } from "./breadcrumbs.js";
import type { ErrorBeat } from "../types.js";

const errorBeats: ErrorBeat[] = [
  { kind: "error", timestampMs: 10_000, projectIndex: 0, serviceName: "checkout", message: "checkout request failed", severity: "error" },
  { kind: "error", timestampMs: 20_000, projectIndex: 1, serviceName: "payments", message: "payments request failed", severity: "error" }
];

describe("generateBreadcrumbBeats", () => {
  it("emits one breadcrumb per error beat, 2 seconds earlier, in the same project/service", () => {
    const beats = generateBreadcrumbBeats(errorBeats);
    expect(beats).toHaveLength(2);
    expect(beats[0]).toMatchObject({ kind: "breadcrumb", timestampMs: 8_000, projectIndex: 0, serviceName: "checkout" });
    expect(beats[1]).toMatchObject({ kind: "breadcrumb", timestampMs: 18_000, projectIndex: 1, serviceName: "payments" });
  });

  it("returns nothing when there are no error beats", () => {
    expect(generateBreadcrumbBeats([])).toEqual([]);
  });
});
