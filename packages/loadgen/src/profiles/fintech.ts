import type { Profile } from "../types.js";

export const FINTECH_PROFILE: Profile = {
  key: "fintech",
  services: [
    { name: "api-gateway", role: "edge", callsServices: ["ledger", "fraud-check"], eventsPerHour: 500, errorRatePercent: 0.5, tracesPerHour: 200, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "ledger", role: "core", callsServices: [], eventsPerHour: 350, errorRatePercent: 0.2, tracesPerHour: 0, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "fraud-check", role: "core", callsServices: [], eventsPerHour: 200, errorRatePercent: 1, tracesPerHour: 0, hasLlmCalls: true, llmCallsPerHour: 200 }
  ],
  incidents: [
    { key: "fraud_check_degraded", serviceName: "fraud-check", errorRateMultiplier: 10, llmCallMultiplier: 1, durationMinutes: 15, monitorKind: "heartbeat" }
  ],
  tenants: [
    { tenantId: "tenant_northwind", traits: { plan: "enterprise", region: "us" } },
    { tenantId: "tenant_contoso", traits: { plan: "pro", region: "eu" } }
  ],
  users: [
    { userId: "user_frank", tenantId: "tenant_northwind", traits: { role: "admin" } },
    { userId: "user_grace", tenantId: "tenant_northwind", traits: { role: "member" } },
    { userId: "user_heidi", tenantId: "tenant_contoso", traits: { role: "admin" } }
  ]
};
