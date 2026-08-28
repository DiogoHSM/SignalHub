import { describe, expect, it } from "vitest";
import { generateIdentityBeats } from "./identity.js";
import { ECOMMERCE_PROFILE } from "../profiles/ecommerce.js";

describe("generateIdentityBeats", () => {
  it("emits one identify beat per tenant and one per user, all at windowStartMs", () => {
    const beats = generateIdentityBeats(ECOMMERCE_PROFILE, 0, 500_000);
    const tenantBeats = beats.filter((beat) => beat.kind === "identifyTenant");
    const userBeats = beats.filter((beat) => beat.kind === "identifyUser");

    expect(tenantBeats).toHaveLength(ECOMMERCE_PROFILE.tenants.length);
    expect(userBeats).toHaveLength(ECOMMERCE_PROFILE.users.length);
    for (const beat of beats) {
      expect(beat.timestampMs).toBe(500_000);
      expect(beat.projectIndex).toBe(0);
    }
  });

  it("carries the tenant/user id and traits through unchanged", () => {
    const beats = generateIdentityBeats(ECOMMERCE_PROFILE, 0, 0);
    const firstTenant = ECOMMERCE_PROFILE.tenants[0];
    const tenantBeat = beats.find((beat) => beat.kind === "identifyTenant" && beat.tenantId === firstTenant.tenantId);
    expect(tenantBeat).toMatchObject({ tenantId: firstTenant.tenantId, traits: firstTenant.traits });

    const firstUser = ECOMMERCE_PROFILE.users[0];
    const userBeat = beats.find((beat) => beat.kind === "identifyUser" && beat.userId === firstUser.userId);
    expect(userBeat).toMatchObject({ userId: firstUser.userId, tenantId: firstUser.tenantId, traits: firstUser.traits });
  });
});
