import { describe, expect, it } from "vitest";
import { placeIncidentWindows } from "./incidents.js";
import { ECOMMERCE_PROFILE } from "../profiles/ecommerce.js";
import { SAAS_B2B_PROFILE } from "../profiles/saas-b2b.js";

describe("placeIncidentWindows", () => {
  it("places one window per incident template per project, at the midpoint of the span", () => {
    const windows = placeIncidentWindows(ECOMMERCE_PROFILE, 2, 0, 3_600_000, 0);
    expect(windows).toHaveLength(ECOMMERCE_PROFILE.incidents.length * 2);

    const projectZeroWindow = windows.find((window) => window.projectIndex === 0);
    expect(projectZeroWindow).toMatchObject({
      incidentKey: "checkout_outage",
      serviceName: "checkout",
      startMs: 1_800_000,
      endMs: 1_800_000 + 20 * 60_000,
      monitorKind: "http",
      errorRateMultiplier: 15,
      llmCallMultiplier: 1
    });
  });

  it("carries llmCallMultiplier for an incident with no monitorKind", () => {
    const windows = placeIncidentWindows(SAAS_B2B_PROFILE, 1, 0, 3_600_000, 0);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ incidentKey: "llm_cost_spike", llmCallMultiplier: 8, monitorKind: undefined });
  });

  it("places the window inside the live portion, not the whole span, when most of the span is backfilled", () => {
    // 3 days backfilled (windowStartMs = -3d), 1 hour live (windowEndMs = +1h), "now" = 0.
    const backfillMs = 3 * 86_400_000;
    const liveMs = 3_600_000;
    const nowMs = 0;
    const windowStartMs = nowMs - backfillMs;
    const windowEndMs = nowMs + liveMs;

    const windows = placeIncidentWindows(ECOMMERCE_PROFILE, 1, windowStartMs, windowEndMs, nowMs);
    const window = windows[0];

    // Must land within the live portion [nowMs, windowEndMs), never in the backfilled past.
    expect(window.startMs).toBeGreaterThanOrEqual(nowMs);
    expect(window.startMs).toBeLessThan(windowEndMs);
  });

  it("keeps the window in the backfilled past (not the future) when there is no live portion at all", () => {
    // 7 days backfilled, no live portion: windowEndMs === nowMs.
    const backfillMs = 7 * 86_400_000;
    const nowMs = backfillMs;
    const windowStartMs = nowMs - backfillMs;
    const windowEndMs = nowMs;

    const windows = placeIncidentWindows(ECOMMERCE_PROFILE, 1, windowStartMs, windowEndMs, nowMs);
    const window = windows[0];

    // The window (and its end) must stay at or before nowMs — never drift into the future,
    // which would make a documented "no live run" command block on a live outage it never asked for.
    expect(window.startMs).toBeLessThanOrEqual(nowMs);
    expect(window.endMs).toBeLessThanOrEqual(nowMs);
  });
});
