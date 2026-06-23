// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantDetailResponse } from "../../api/types";
import { buildTenantVM, useTenant } from "./useTenant";

afterEach(() => vi.restoreAllMocks());

const RESPONSE: TenantDetailResponse = {
  window: "24h",
  generatedAt: "2026-06-23T13:00:00.000Z",
  scope: { projectId: "p", environmentId: "e" },
  range: { from: "2026-06-22T13:00:00.000Z", to: "2026-06-23T13:00:00.000Z" },
  tenant: {
    tenantId: "tenant_acme", label: "Acme Corp", traits: {},
    keyTraits: { plan: "Enterprise", status: "active" },
    isUnassigned: false, impactScore: 42, lastSeenAt: "2026-06-23T12:59:00.000Z",
    events: 482000, errors: 148, openErrors: 4, severeErrors: 2,
    traces: 1820, failedTraces: 12, llmCalls: 32014, failedLlmCalls: 8,
    llmCostUsd: "68.42", activeUsers: 142, activeSessions: 3418,
  },
  topUsers: [
    { userId: "user_8420", events: 1842, errors: 2, traces: 90, llmCalls: 120, llmCostUsd: "24.18", lastSeenAt: "2026-06-23T12:50:00.000Z" },
  ],
  timeline: [
    { type: "error", id: "er1", timestamp: "2026-06-23T12:42:32.000Z", label: "PaymentTimeoutError", userId: "user_8420", sessionId: null, traceId: null, severity: "critical", status: "open", message: "PaymentTimeoutError: provider timeout" },
    { type: "llm", id: "ll1", timestamp: "2026-06-23T12:41:50.000Z", label: "fraud_check", userId: "user_8420", sessionId: null, traceId: "tr1", provider: "anthropic", model: "claude-3.7", promptName: "fraud_check", status: "success", costUsd: "0.0042" },
    { type: "trace", id: "tc1", timestamp: "2026-06-23T12:40:18.000Z", label: "generate_dashboard", userId: "user_8420", sessionId: null, traceId: "tr2", status: "success", durationMs: 1840, name: "generate_dashboard" },
    { type: "event", id: "ev1", timestamp: "2026-06-23T12:35:14.000Z", label: "user.logged_in", userId: "user_8420", sessionId: "sess_1", traceId: null, eventName: "user.logged_in" },
  ],
};

describe("buildTenantVM", () => {
  it("derives header initials, label, id, status, and plan", () => {
    const vm = buildTenantVM(RESPONSE);
    expect(vm.header.initials).toBe("AC");
    expect(vm.header.label).toBe("Acme Corp");
    expect(vm.header.tenantId).toBe("tenant_acme");
    expect(vm.header.statusLabel).toBe("active");
    expect(vm.header.plan).toBe("Enterprise");
  });

  it("maps the six KPIs in order with formatted values", () => {
    const vm = buildTenantVM(RESPONSE);
    expect(vm.kpis.map((k) => k.label)).toEqual(["Active users", "Events", "LLM cost", "Errors", "Traces", "Sessions"]);
    expect(vm.kpis[1].value).toBe("482K"); // events compact
    expect(vm.kpis[2].value).toBe("$ 68.42"); // llm cost
    expect(vm.kpis[5].value).toBe("3,418"); // sessions
  });

  it("maps timeline rows to icon/tone/nav per type", () => {
    const vm = buildTenantVM(RESPONSE);
    const [err, llm, trace, evt] = vm.timeline;
    expect(err.icon).toBe("error");
    expect(err.tone).toBe("critical");
    expect(err.navTo).toBeNull(); // no groupId → not drillable
    expect(err.clock).toBe("12:42:32");
    expect(llm.icon).toBe("sparkles");
    expect(llm.tone).toBe("violet");
    expect(llm.navTo).toBe("llm");
    expect(trace.icon).toBe("waterfall");
    expect(trace.navTo).toBe("traces");
    expect(evt.icon).toBe("activity");
    expect(evt.navTo).toBeNull();
  });

  it("maps top users with initials, events, and cost", () => {
    const vm = buildTenantVM(RESPONSE);
    expect(vm.topUsers[0].userId).toBe("user_8420");
    expect(vm.topUsers[0].events).toBe("1,842");
    expect(vm.topUsers[0].cost).toBe("$ 24.18");
  });

  it("builds activity-by-type bars with ratios relative to the max", () => {
    const vm = buildTenantVM(RESPONSE);
    expect(vm.signalBars.map((b) => b.label)).toEqual(["Events", "LLM calls", "Traces", "Errors"]);
    const events = vm.signalBars[0];
    expect(events.ratio).toBe(1); // events is the max
    expect(events.display).toBe("482K");
  });

  it("falls back gracefully when tenant fields are missing", () => {
    const vm = buildTenantVM({
      ...RESPONSE,
      tenant: { ...RESPONSE.tenant, tenantId: null, label: "", keyTraits: {}, lastSeenAt: null },
      topUsers: [], timeline: [],
    });
    expect(vm.header.initials).toBe("?");
    expect(vm.header.tenantId).toBe("—");
    expect(vm.header.statusLabel).toBe("inactive");
    expect(vm.header.plan).toBe("—");
    expect(vm.timeline).toEqual([]);
    expect(vm.topUsers).toEqual([]);
  });
});

describe("useTenant", () => {
  it("fetches detail and resolves to ok with the raw response", async () => {
    const getEntityTenantDetail = vi.fn().mockResolvedValue({ data: RESPONSE });
    const { result } = renderHook(() =>
      useTenant({ client: { getEntityTenantDetail }, projectId: "p", environmentId: "e", tenantId: "tenant_acme", window: "24h" })
    );
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data).toEqual(RESPONSE);
    expect(getEntityTenantDetail).toHaveBeenCalledWith("tenant_acme", { projectId: "p", environmentId: "e", window: "24h" });
  });

  it("does not fetch without project/env/tenant", () => {
    const getEntityTenantDetail = vi.fn();
    renderHook(() => useTenant({ client: { getEntityTenantDetail }, projectId: undefined, environmentId: "e", tenantId: "t", window: "24h" }));
    expect(getEntityTenantDetail).not.toHaveBeenCalled();
  });

  it("resolves to error when the fetch rejects", async () => {
    const getEntityTenantDetail = vi.fn().mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useTenant({ client: { getEntityTenantDetail }, projectId: "p", environmentId: "e", tenantId: "t", window: "24h" })
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });
});
