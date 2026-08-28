import type { Profile } from "../types.js";

export const SAAS_B2B_PROFILE: Profile = {
  key: "saas-b2b",
  services: [
    { name: "api-gateway", role: "edge", callsServices: ["billing", "support-bot"], eventsPerHour: 450, errorRatePercent: 0.5, tracesPerHour: 180, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "billing", role: "core", callsServices: [], eventsPerHour: 120, errorRatePercent: 0.3, tracesPerHour: 0, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "support-bot", role: "core", callsServices: [], eventsPerHour: 250, errorRatePercent: 0.5, tracesPerHour: 0, hasLlmCalls: true, llmCallsPerHour: 500 }
  ],
  incidents: [
    { key: "llm_cost_spike", serviceName: "support-bot", errorRateMultiplier: 1, llmCallMultiplier: 8, durationMinutes: 30 }
  ],
  tenants: [
    { tenantId: "tenant_umbrella", traits: { plan: "enterprise", seats: 200 } },
    { tenantId: "tenant_soylent", traits: { plan: "pro", seats: 40 } }
  ],
  users: [
    { userId: "user_ivan", tenantId: "tenant_umbrella", traits: { role: "admin" } },
    { userId: "user_judy", tenantId: "tenant_umbrella", traits: { role: "member" } },
    { userId: "user_karl", tenantId: "tenant_soylent", traits: { role: "admin" } }
  ]
};
