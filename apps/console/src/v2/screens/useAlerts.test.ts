// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AlertEventResponse,
  AlertRuleResponse,
  NotificationChannelResponse,
} from "../../api/types";
import { buildAlertsVM, useAlerts } from "./useAlerts";

const NOW = Date.UTC(2026, 5, 23, 12, 0, 0); // 2026-06-23T12:00:00Z (Tue)

function rule(over: Partial<AlertRuleResponse> = {}): AlertRuleResponse {
  return {
    id: "r1",
    projectId: "p",
    environmentId: "e",
    notificationChannelId: null,
    name: "Critical errors in production",
    type: "critical_errors",
    severity: "critical",
    windowMinutes: 5,
    threshold: "1",
    cooldownMinutes: 10,
    routePattern: null,
    minimumSampleSize: 0,
    enabled: true,
    lastEvaluatedAt: null,
    lastTriggeredAt: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    ...over,
  };
}

function event(over: Partial<AlertEventResponse> = {}): AlertEventResponse {
  return {
    id: "e1",
    ruleId: "r1",
    monitorId: null,
    projectId: "p",
    environmentId: "e",
    status: "triggered",
    severity: "critical",
    triggeredAt: "2026-06-23T09:00:00.000Z",
    windowStart: "2026-06-23T08:55:00.000Z",
    windowEnd: "2026-06-23T09:00:00.000Z",
    observedValue: "3",
    threshold: "1",
    message: "fired",
    metadata: null,
    createdAt: "2026-06-23T09:00:00.000Z",
    latestDeliveryStatus: "success",
    ...over,
  };
}

const webhookChannel: NotificationChannelResponse = {
  id: "c1",
  name: "Slack · #incidents",
  type: "webhook",
  url: "https://hooks.slack.com/services/T0/abc",
  emailRecipients: [],
  secretHeaderName: null,
  hasSecret: false,
  enabled: true,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  archivedAt: null,
};

const emailChannel: NotificationChannelResponse = {
  id: "c2",
  name: "Email · finance",
  type: "email",
  url: null,
  emailRecipients: ["finance@acme.dev", "cfo@acme.dev"],
  secretHeaderName: null,
  hasSecret: false,
  enabled: false,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  archivedAt: null,
};

describe("buildAlertsVM", () => {
  it("maps a rule row with severity tag, subLabel, resolved channel, fires7d", () => {
    const vm = buildAlertsVM(
      {
        rules: [rule({ notificationChannelId: "c1" })],
        events: [event(), event({ id: "e2" })],
        channels: [webhookChannel],
      },
      NOW,
    );
    expect(vm.rules).toHaveLength(1);
    const r = vm.rules[0];
    expect(r.name).toBe("Critical errors in production");
    expect(r.subLabel).toBe("critical_errors · 1 · 5m");
    expect(r.severity).toBe("critical");
    expect(r.severityTag).toBe("critical");
    expect(r.enabled).toBe(true);
    expect(r.channelLabel).toBe("Slack · #incidents");
    expect(r.fires7d).toBe(2);
  });

  it("falls back to Unassigned channel and maps warn/'' severity tags", () => {
    const vm = buildAlertsVM(
      {
        rules: [
          rule({ id: "r2", severity: "warning", notificationChannelId: "missing" }),
          rule({ id: "r3", severity: "info", notificationChannelId: null }),
        ],
        events: [],
        channels: [],
      },
      NOW,
    );
    expect(vm.rules[0].severityTag).toBe("warn");
    expect(vm.rules[0].channelLabel).toBe("Unassigned");
    expect(vm.rules[1].severityTag).toBe("");
    expect(vm.rules[1].channelLabel).toBe("Unassigned");
  });

  it("counts header active rules (enabled, non-archived) and 7d fires", () => {
    const vm = buildAlertsVM(
      {
        rules: [
          rule({ id: "r1", enabled: true }),
          rule({ id: "r2", enabled: false }),
          rule({ id: "r3", enabled: true, archivedAt: "2026-06-10T00:00:00.000Z" }),
        ],
        events: [event(), event({ id: "e2", triggeredAt: "2026-06-20T00:00:00.000Z" })],
        channels: [],
      },
      NOW,
    );
    expect(vm.header.activeRuleCount).toBe(1);
    expect(vm.header.fires7d).toBe(2);
  });

  it("maps channel rows by type with target and ok flag", () => {
    const vm = buildAlertsVM(
      { rules: [], events: [], channels: [webhookChannel, emailChannel] },
      NOW,
    );
    expect(vm.channels[0]).toMatchObject({
      icon: "webhook",
      target: "https://hooks.slack.com/services/T0/abc",
      ok: true,
    });
    expect(vm.channels[1]).toMatchObject({
      icon: "mail",
      target: "finance@acme.dev, cfo@acme.dev",
      ok: false,
    });
  });

  it("buckets the timeline into 7 UTC days ending today, by hour and tone", () => {
    const vm = buildAlertsVM(
      {
        rules: [],
        channels: [],
        events: [
          event({ id: "today", triggeredAt: "2026-06-23T06:00:00.000Z", severity: "critical" }),
          event({ id: "sixago", triggeredAt: "2026-06-17T12:00:00.000Z", severity: "warning" }),
          event({ id: "old", triggeredAt: "2026-06-15T12:00:00.000Z" }),
        ],
      },
      NOW,
    );
    expect(vm.timeline).toHaveLength(7);
    expect(vm.timeline[6].label).toBe("Tue 23");
    expect(vm.timeline[6].fires).toHaveLength(1);
    expect(vm.timeline[6].fires[0].hourFraction).toBeCloseTo(0.25, 5);
    expect(vm.timeline[6].fires[0].tone).toBe("critical");
    expect(vm.timeline[0].fires).toHaveLength(1);
    expect(vm.timeline[0].fires[0].tone).toBe("warn");
    const totalFires = vm.timeline.reduce((n, d) => n + d.fires.length, 0);
    expect(totalFires).toBe(2); // 8-days-ago event excluded
  });

  it("skips events with invalid timestamps", () => {
    const vm = buildAlertsVM(
      { rules: [], channels: [], events: [event({ triggeredAt: "not-a-date" })] },
      NOW,
    );
    expect(vm.header.fires7d).toBe(0);
    expect(vm.timeline.every((d) => d.fires.length === 0)).toBe(true);
  });
});

describe("useAlerts", () => {
  function makeClient() {
    return {
      listAlertRules: vi.fn().mockResolvedValue({ rules: [rule()] }),
      listAlertEvents: vi.fn().mockResolvedValue({ data: [event()] }),
      listNotificationChannels: vi.fn().mockResolvedValue({ channels: [webhookChannel] }),
    };
  }

  it("loads and builds a VM", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useAlerts({ client, projectId: "p", environmentId: "e" }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.rules).toHaveLength(1);
    expect(result.current.data?.channels).toHaveLength(1);
    expect(client.listAlertEvents).toHaveBeenCalledWith({
      projectId: "p",
      environmentId: "e",
      limit: 100,
    });
  });

  it("no-ops without project/environment", () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useAlerts({ client, projectId: undefined, environmentId: undefined }),
    );
    expect(result.current.status).toBe("loading");
    expect(client.listAlertRules).not.toHaveBeenCalled();
  });
});
