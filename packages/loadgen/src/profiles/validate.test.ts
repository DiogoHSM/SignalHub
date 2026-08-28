import { describe, expect, it } from "vitest";
import { validateProfile } from "./validate.js";
import { ECOMMERCE_PROFILE } from "./ecommerce.js";
import type { Profile } from "../types.js";

describe("validateProfile", () => {
  it("returns no problems for the ecommerce profile", () => {
    expect(validateProfile(ECOMMERCE_PROFILE)).toEqual([]);
  });

  it("flags a service that calls an undeclared service", () => {
    const broken: Profile = {
      ...ECOMMERCE_PROFILE,
      services: [
        { ...ECOMMERCE_PROFILE.services[0], callsServices: ["nonexistent"] },
        ...ECOMMERCE_PROFILE.services.slice(1)
      ]
    };

    expect(validateProfile(broken)).toEqual([
      'service "api-gateway" calls undeclared service "nonexistent"'
    ]);
  });

  it("flags an incident targeting an undeclared service", () => {
    const broken: Profile = {
      ...ECOMMERCE_PROFILE,
      incidents: [{ key: "bad", serviceName: "nonexistent", errorRateMultiplier: 2, llmCallMultiplier: 1, durationMinutes: 5 }]
    };

    expect(validateProfile(broken)).toEqual([
      'incident "bad" targets undeclared service "nonexistent"'
    ]);
  });

  it("flags a user whose tenantId is not one of the declared tenants", () => {
    const broken: Profile = {
      ...ECOMMERCE_PROFILE,
      users: [{ userId: "user_orphan", tenantId: "tenant_nonexistent", traits: {} }]
    };

    expect(validateProfile(broken)).toEqual([
      'user "user_orphan" references undeclared tenant "tenant_nonexistent"'
    ]);
  });

  it("returns no problems for every built-in profile", async () => {
    const { PROFILES } = await import("./index.js");
    for (const profile of Object.values(PROFILES)) {
      expect(validateProfile(profile)).toEqual([]);
    }
  });
});
