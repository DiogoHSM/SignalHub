import type { IdentifyTenantBeat, IdentifyUserBeat, Profile } from "../types.js";

export function generateIdentityBeats(
  profile: Profile,
  projectIndex: number,
  windowStartMs: number
): (IdentifyUserBeat | IdentifyTenantBeat)[] {
  const anchorServiceName = profile.services[0].name;
  const beats: (IdentifyUserBeat | IdentifyTenantBeat)[] = [];

  for (const tenant of profile.tenants) {
    beats.push({
      kind: "identifyTenant",
      timestampMs: windowStartMs,
      projectIndex,
      serviceName: anchorServiceName,
      tenantId: tenant.tenantId,
      traits: tenant.traits
    });
  }

  for (const user of profile.users) {
    beats.push({
      kind: "identifyUser",
      timestampMs: windowStartMs,
      projectIndex,
      serviceName: anchorServiceName,
      userId: user.userId,
      tenantId: user.tenantId,
      traits: user.traits
    });
  }

  return beats;
}
