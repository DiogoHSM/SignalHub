import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { AlertsPanel } from "./AlertsPanel";

afterEach(() => {
  cleanup();
});

function client(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listAlertRules: vi.fn().mockResolvedValue({ rules: [] }),
    listNotificationChannels: vi.fn().mockResolvedValue({ channels: [] }),
    listAlertEvents: vi.fn().mockResolvedValue({ data: [] }),
    createAlertRule: vi.fn().mockResolvedValue({
      rule: {
        id: "rule_1",
        projectId: "prj_1",
        environmentId: "env_1",
        notificationChannelId: null,
        name: "Critical errors",
        type: "critical_errors",
        severity: "critical",
        windowMinutes: 10,
        threshold: "1",
        cooldownMinutes: 30,
        enabled: true,
        lastEvaluatedAt: null,
        lastTriggeredAt: null,
        createdAt: "",
        updatedAt: "",
        archivedAt: null
      }
    }),
    createNotificationChannel: vi.fn().mockResolvedValue({
      channel: {
        id: "chn_1",
        name: "Ops",
        type: "webhook",
        url: "https://hooks.example.com",
        secretHeaderName: "X-SignalHub-Secret",
        hasSecret: true,
        enabled: true,
        createdAt: "",
        updatedAt: "",
        archivedAt: null
      }
    }),
    ...overrides
  } as ApiClient;
}

describe("AlertsPanel", () => {
  it("renders alert rules channels and recent history", async () => {
    const api = client({
      listAlertRules: vi.fn().mockResolvedValue({
        rules: [
          {
            id: "rule_1",
            projectId: "prj_1",
            environmentId: "env_1",
            notificationChannelId: "chn_1",
            name: "Critical errors",
            type: "critical_errors",
            severity: "critical",
            windowMinutes: 10,
            threshold: "1",
            cooldownMinutes: 30,
            enabled: true,
            lastEvaluatedAt: null,
            lastTriggeredAt: "2026-05-06T12:00:00.000Z",
            createdAt: "2026-05-06T11:00:00.000Z",
            updatedAt: "2026-05-06T11:00:00.000Z",
            archivedAt: null
          }
        ]
      }),
      listNotificationChannels: vi.fn().mockResolvedValue({
        channels: [
          {
            id: "chn_1",
            name: "Ops",
            type: "webhook",
            url: "https://hooks.example.com",
            secretHeaderName: null,
            hasSecret: false,
            enabled: true,
            createdAt: "2026-05-06T11:00:00.000Z",
            updatedAt: "2026-05-06T11:00:00.000Z",
            archivedAt: null
          }
        ]
      }),
      listAlertEvents: vi.fn().mockResolvedValue({
        data: [
          {
            id: "evt_1",
            ruleId: "rule_1",
            projectId: "prj_1",
            environmentId: "env_1",
            status: "triggered",
            severity: "critical",
            triggeredAt: "2026-05-06T12:00:00.000Z",
            windowStart: "2026-05-06T11:50:00.000Z",
            windowEnd: "2026-05-06T12:00:00.000Z",
            observedValue: "2",
            threshold: "1",
            message: "Critical errors threshold reached",
            metadata: {},
            createdAt: "2026-05-06T12:00:00.000Z",
            latestDeliveryStatus: "success"
          }
        ]
      })
    });

    render(<AlertsPanel client={api} projectId="prj_1" environmentId="env_1" />);

    expect(await screen.findByRole("heading", { name: "Alerts" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Alert rules")).getByText("Critical errors")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Notification channels")).getByText("Ops")).toBeInTheDocument();
    expect(screen.getByText("Critical errors threshold reached")).toBeInTheDocument();
    expect(screen.getByText("success")).toBeInTheDocument();
    expect(api.listAlertRules).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });
    expect(api.listAlertEvents).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 20 });
  });

  it("creates a webhook channel without displaying the saved secret", async () => {
    const createNotificationChannel = vi.fn().mockResolvedValue({
      channel: {
        id: "chn_1",
        name: "Ops",
        type: "webhook",
        url: "https://hooks.example.com",
        secretHeaderName: "X-SignalHub-Secret",
        hasSecret: true,
        enabled: true,
        createdAt: "",
        updatedAt: "",
        archivedAt: null
      }
    });

    render(<AlertsPanel client={client({ createNotificationChannel })} projectId="prj_1" environmentId="env_1" />);

    await userEvent.type(await screen.findByLabelText("Channel name"), "Ops");
    await userEvent.type(screen.getByLabelText("Webhook URL"), "https://hooks.example.com");
    await userEvent.type(screen.getByLabelText("Secret header name"), "X-SignalHub-Secret");
    await userEvent.type(screen.getByLabelText("Secret header value"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Create channel" }));

    await waitFor(() =>
      expect(createNotificationChannel).toHaveBeenCalledWith({
        name: "Ops",
        type: "webhook",
        url: "https://hooks.example.com",
        secretHeaderName: "X-SignalHub-Secret",
        secretHeaderValue: "secret",
        enabled: true
      })
    );
    expect(screen.queryByDisplayValue("secret")).not.toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("Notification channels")).getByText("Secret saved")).toBeInTheDocument();
  });

  it("creates an alert rule for the active project and environment", async () => {
    const createAlertRule = vi.fn().mockResolvedValue({
      rule: {
        id: "rule_1",
        projectId: "prj_1",
        environmentId: "env_1",
        notificationChannelId: "chn_1",
        name: "Critical errors",
        type: "critical_errors",
        severity: "critical",
        windowMinutes: 10,
        threshold: "1",
        cooldownMinutes: 30,
        enabled: true,
        lastEvaluatedAt: null,
        lastTriggeredAt: null,
        createdAt: "",
        updatedAt: "",
        archivedAt: null
      }
    });
    const api = client({
      createAlertRule,
      listNotificationChannels: vi.fn().mockResolvedValue({
        channels: [
          {
            id: "chn_1",
            name: "Ops",
            type: "webhook",
            url: "https://hooks.example.com",
            secretHeaderName: null,
            hasSecret: false,
            enabled: true,
            createdAt: "",
            updatedAt: "",
            archivedAt: null
          }
        ]
      })
    });

    render(<AlertsPanel client={api} projectId="prj_1" environmentId="env_1" />);

    await userEvent.type(await screen.findByLabelText("Rule name"), "Critical errors");
    await userEvent.selectOptions(screen.getByLabelText("Notification channel"), "chn_1");
    await userEvent.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() =>
      expect(createAlertRule).toHaveBeenCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        notificationChannelId: "chn_1",
        name: "Critical errors",
        type: "critical_errors",
        severity: "critical",
        windowMinutes: 10,
        threshold: "1",
        cooldownMinutes: 30,
        enabled: true
      })
    );
  });

  it("shows a compact empty state without project or environment", () => {
    const api = client();

    render(<AlertsPanel client={api} />);

    expect(screen.getByRole("heading", { name: "Alerts" })).toBeInTheDocument();
    expect(screen.getByText("Select a project and environment to manage alerts.")).toBeInTheDocument();
    expect(api.listAlertRules).not.toHaveBeenCalled();
  });
});
