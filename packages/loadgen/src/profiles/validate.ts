import type { Profile } from "../types.js";

export function validateProfile(profile: Profile): string[] {
  const problems: string[] = [];
  const serviceNames = new Set(profile.services.map((service) => service.name));
  const tenantIds = new Set(profile.tenants.map((tenant) => tenant.tenantId));

  for (const service of profile.services) {
    for (const calleeName of service.callsServices) {
      if (!serviceNames.has(calleeName)) {
        problems.push(`service "${service.name}" calls undeclared service "${calleeName}"`);
      }
    }
  }

  for (const incident of profile.incidents) {
    if (!serviceNames.has(incident.serviceName)) {
      problems.push(`incident "${incident.key}" targets undeclared service "${incident.serviceName}"`);
    }
  }

  for (const user of profile.users) {
    if (user.tenantId !== undefined && !tenantIds.has(user.tenantId)) {
      problems.push(`user "${user.userId}" references undeclared tenant "${user.tenantId}"`);
    }
  }

  return problems;
}
