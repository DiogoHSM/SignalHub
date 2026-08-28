import type { Profile } from "../types.js";

export const ECOMMERCE_PROFILE: Profile = {
  key: "ecommerce",
  services: [
    { name: "api-gateway", role: "edge", callsServices: ["checkout", "catalog"], eventsPerHour: 600, errorRatePercent: 1, tracesPerHour: 200, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "checkout", role: "core", callsServices: ["payments", "inventory"], eventsPerHour: 300, errorRatePercent: 2, tracesPerHour: 150, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "payments", role: "core", callsServices: [], eventsPerHour: 150, errorRatePercent: 0.5, tracesPerHour: 0, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "inventory", role: "core", callsServices: [], eventsPerHour: 100, errorRatePercent: 1, tracesPerHour: 0, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "catalog", role: "core", callsServices: [], eventsPerHour: 400, errorRatePercent: 0.5, tracesPerHour: 0, hasLlmCalls: false, llmCallsPerHour: 0 }
  ],
  incidents: [
    { key: "checkout_outage", serviceName: "checkout", errorRateMultiplier: 15, llmCallMultiplier: 1, durationMinutes: 20, monitorKind: "http" }
  ],
  tenants: [
    { tenantId: "tenant_acme", traits: { plan: "enterprise", employees: 500 } },
    { tenantId: "tenant_globex", traits: { plan: "pro", employees: 80 } },
    { tenantId: "tenant_initech", traits: { plan: "starter", employees: 12 } }
  ],
  users: [
    { userId: "user_alice", tenantId: "tenant_acme", traits: { role: "admin" } },
    { userId: "user_bob", tenantId: "tenant_acme", traits: { role: "member" } },
    { userId: "user_carol", tenantId: "tenant_globex", traits: { role: "admin" } },
    { userId: "user_dave", tenantId: "tenant_globex", traits: { role: "member" } },
    { userId: "user_erin", tenantId: "tenant_initech", traits: { role: "admin" } }
  ]
};
