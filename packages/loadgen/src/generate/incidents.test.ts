import { describe, expect, it } from "vitest";
import { placeIncidentWindows } from "./incidents.js";
import { ECOMMERCE_PROFILE } from "../profiles/ecommerce.js";
import { SAAS_B2B_PROFILE } from "../profiles/saas-b2b.js";

describe("placeIncidentWindows", () => {
  it("places one window per incident template per project, at the midpoint of the span", () => {
    const windows = placeIncidentWindows(ECOMMERCE_PROFILE, 2, 0, 3_600_000);
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
    const windows = placeIncidentWindows(SAAS_B2B_PROFILE, 1, 0, 3_600_000);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ incidentKey: "llm_cost_spike", llmCallMultiplier: 8, monitorKind: undefined });
  });
});
