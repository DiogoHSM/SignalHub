// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildMonitorsVM, buildCheckVMs, monitorStatusToV2, useMonitors } from "./useMonitors";
import type { ApiClient } from "../../api/client";
import type { MonitorResponse, MonitorCheckResponse, NotificationChannelResponse } from "../../api/types";

const NOW = Date.parse("2026-06-24T12:00:00.000Z");

function httpMonitor(over: Partial<MonitorResponse> = {}): MonitorResponse {
  return {
    id: "mon_http", projectId: "p", environmentId: "e", notificationChannelId: "ch_1",
    kind: "http", name: "API health", enabled: true, status: "up",
    url: "https://api.example.com/health", method: "GET", expectedStatus: "2xx",
    bodyContains: null, timeoutMs: 5000, intervalMinutes: 5,
    failureThreshold: 2, recoveryThreshold: 2, consecutiveFailures: 0, consecutiveSuccesses: 3,
    expectedIntervalMinutes: null, graceMinutes: null,
    lastCheckedAt: "2026-06-24T11:48:00.000Z", lastCheckStatus: "success", lastCheckLatencyMs: 134,
    lastCheckResponseStatus: 200, lastCheckErrorMessage: null, lastHeartbeatAt: null,
    createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-24T11:48:00.000Z", archivedAt: null,
    ...over,
  };
}

function heartbeatMonitor(over: Partial<MonitorResponse> = {}): MonitorResponse {
  return {
    ...httpMonitor(),
    id: "mon_hb", kind: "heartbeat", name: "Worker beat", status: "down",
    url: null, method: null, expectedStatus: null, timeoutMs: null, intervalMinutes: null,
    notificationChannelId: null,
    expectedIntervalMinutes: 5, graceMinutes: 2, lastHeartbeatAt: "2026-06-24T10:00:00.000Z",
    lastCheckedAt: null, lastCheckStatus: null, lastCheckResponseStatus: null, lastCheckLatencyMs: null,
    ...over,
  };
}

const channels: NotificationChannelResponse[] = [
  { id: "ch_1", name: "Ops webhook", type: "webhook", url: "https://hook", emailRecipients: [], secretHeaderName: null, hasSecret: false, enabled: true, createdAt: "x", updatedAt: "x", archivedAt: null },
];

describe("monitorStatusToV2", () => {
  it("maps every MonitorStatus to a v2 Status", () => {
    expect(monitorStatusToV2("up")).toBe("ok");
    expect(monitorStatusToV2("degraded")).toBe("warning");
    expect(monitorStatusToV2("down")).toBe("critical");
    expect(monitorStatusToV2("paused")).toBe("idle");
    expect(monitorStatusToV2("unknown")).toBe("idle");
  });
});

describe("buildMonitorsVM", () => {
  it("builds http and heartbeat rows with target, cadence, channel and last-check labels", () => {
    const vm = buildMonitorsVM({ monitors: [httpMonitor(), heartbeatMonitor()], channels }, NOW);
    const http = vm.rows.find((r) => r.id === "mon_http")!;
    const hb = vm.rows.find((r) => r.id === "mon_hb")!;

    expect(http.kind).toBe("http");
    expect(http.statusV2).toBe("ok");
    expect(http.target).toBe("https://api.example.com/health");
    expect(http.cadence).toBe("every 5m");
    expect(http.channelLabel).toBe("Ops webhook");
    expect(http.hasChannel).toBe(true);
    expect(http.lastCheckedLabel).toBe("12m ago");

    expect(hb.kind).toBe("heartbeat");
    expect(hb.statusV2).toBe("critical");
    expect(hb.target).toBe("Heartbeat check-in");
    expect(hb.cadence).toBe("expects every 5m ±2m");
    expect(hb.channelLabel).toBeNull();
    expect(hb.hasChannel).toBe(false);
    expect(hb.lastCheckedLabel).toBe("Never");
  });

  it("computes a rollup over all monitors", () => {
    const vm = buildMonitorsVM(
      { monitors: [httpMonitor(), heartbeatMonitor(), httpMonitor({ id: "m3", status: "degraded", enabled: false, notificationChannelId: null })], channels },
      NOW,
    );
    expect(vm.rollup.total).toBe(3);
    expect(vm.rollup.up).toBe(1);
    expect(vm.rollup.down).toBe(1);
    expect(vm.rollup.degraded).toBe(1);
    expect(vm.rollup.paused).toBe(0);
    expect(vm.rollup.enabled).toBe(2);
    expect(vm.rollup.withoutChannel).toBe(2);
  });

  it("exposes channel options for selects", () => {
    const vm = buildMonitorsVM({ monitors: [], channels }, NOW);
    expect(vm.channels).toEqual([{ id: "ch_1", label: "Ops webhook · webhook" }]);
  });
});

describe("buildCheckVMs", () => {
  it("maps checks to status, label and detail", () => {
    const checks: MonitorCheckResponse[] = [
      { id: "c1", monitorId: "m", checkedAt: "2026-06-24T11:59:00.000Z", status: "success", latencyMs: 120, responseStatus: 200, errorMessage: null, createdAt: "x" },
      { id: "c2", monitorId: "m", checkedAt: "2026-06-24T11:00:00.000Z", status: "failed", latencyMs: null, responseStatus: 500, errorMessage: "Timeout", createdAt: "x" },
    ];
    const vms = buildCheckVMs(checks, NOW);
    expect(vms[0].statusV2).toBe("ok");
    expect(vms[0].checkedLabel).toBe("1m ago");
    expect(vms[0].detail).toBe("200 · 120ms");
    expect(vms[1].statusV2).toBe("critical");
    expect(vms[1].hasError).toBe(true);
    expect(vms[1].detail).toBe("500 · Timeout");
  });
});

describe("useMonitors hook", () => {
  it("loads monitors + channels and builds the VM", async () => {
    const client = {
      listMonitors: vi.fn().mockResolvedValue({ monitors: [httpMonitor()] }),
      listNotificationChannels: vi.fn().mockResolvedValue({ channels }),
    } as unknown as ApiClient;
    const { result } = renderHook(() =>
      useMonitors({ client, projectId: "p", environmentId: "e", endpoint: "https://x.test" }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.rows).toHaveLength(1);
    expect(result.current.data?.rollup.total).toBe(1);
  });

  it("reports 'unavailable' when monitor methods are absent", async () => {
    const client = {} as unknown as ApiClient;
    const { result } = renderHook(() =>
      useMonitors({ client, projectId: "p", environmentId: "e", endpoint: "https://x.test" }),
    );
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.data).toBeNull();
  });
});
