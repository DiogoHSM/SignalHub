import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { AlertsPanel } from "./AlertsPanel";

afterEach(() => {
  cleanup();
});

function client(overrides: Partial<ApiClient> = {}): ApiClient {
  const baseClient = {
    getConsoleConfig: vi.fn(),
    fetchFleet: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn(),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn(),
    listErrors: vi.fn(),
    listTraces: vi.fn(),
    listTraceSpans: vi.fn(),
    listLlmCalls: vi.fn(),
    getLlmAggregates: vi.fn(),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getOverview: vi.fn(),
    getSystemHealth: vi.fn(),
    listEntityTenants: vi.fn(),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn(),
    getUserDetail: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    listAlertRules: vi.fn().mockResolvedValue({ rules: [] }),
    listNotificationChannels: vi.fn().mockResolvedValue({ channels: [] }),
    listAlertEvents: vi.fn().mockResolvedValue({ data: [] }),
    getAlertEvent: vi.fn(),
    listErrorGroups: vi.fn().mockResolvedValue({ data: [] }),
    getErrorGroup: vi.fn(),
    getErrorGroupIncident: vi.fn(),
    updateErrorGroupStatus: vi.fn(),
    updateErrorGroupTriage: vi.fn(),
    addTriageNote: vi.fn(),
    silenceIncident: vi.fn(),
    getSessionTimeline: vi.fn().mockResolvedValue({ data: { sessionId: "sess_1", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: null, to: null }, items: [], page: { nextCursor: null, previousCursor: null } } }),
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
    updateAlertRule: vi.fn(),
    archiveAlertRule: vi.fn(),
    createNotificationChannel: vi.fn().mockResolvedValue({
      channel: {
        id: "chn_1",
        name: "Ops",
        type: "webhook",
        url: "https://hooks.example.com",
        emailRecipients: [],
        secretHeaderName: "X-SignalMonitor-Secret",
        hasSecret: true,
        enabled: true,
        createdAt: "",
        updatedAt: "",
        archivedAt: null
      }
    }),
    updateNotificationChannel: vi.fn(),
    archiveNotificationChannel: vi.fn(),
    ...overrides
  } satisfies ApiClient;
  return baseClient;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
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
            emailRecipients: [],
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
            monitorId: null,
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

  it("summarizes alert posture, delivery state, and setup suggestions", async () => {
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
          },
          {
            id: "rule_2",
            projectId: "prj_1",
            environmentId: "env_1",
            notificationChannelId: null,
            name: "Trace p95",
            type: "trace_p95_latency",
            severity: "warning",
            windowMinutes: 15,
            threshold: "750",
            cooldownMinutes: 30,
            enabled: true,
            lastEvaluatedAt: null,
            lastTriggeredAt: null,
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
            emailRecipients: [],
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
            monitorId: null,
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
            latestDeliveryStatus: "failed"
          }
        ]
      })
    });

    render(<AlertsPanel client={api} projectId="prj_1" environmentId="env_1" />);

    const posture = await screen.findByRole("region", { name: "Alert posture" });
    expect(within(posture).getByText("Firing now")).toBeInTheDocument();
    expect(within(posture).getAllByText("1").length).toBeGreaterThanOrEqual(3);
    expect(within(posture).getByText("Delivery issues")).toBeInTheDocument();
    expect(within(posture).getByText("Rules without channels")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Alert history heat strip" })).toBeInTheDocument();
    expect(screen.getByText("Attach channels to enabled rules")).toBeInTheDocument();
    expect(screen.getByText("1 enabled rule has no notification channel.")).toBeInTheDocument();
  });

  it("archives an alert rule after confirmation and removes it from the rule list", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const archiveAlertRule = vi.fn().mockResolvedValue(undefined);
    const api = client({
      archiveAlertRule,
      listAlertRules: vi.fn().mockResolvedValue({
        rules: [
          {
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
            createdAt: "2026-05-06T11:00:00.000Z",
            updatedAt: "2026-05-06T11:00:00.000Z",
            archivedAt: null
          }
        ]
      })
    });

    render(<AlertsPanel client={api} projectId="prj_1" environmentId="env_1" />);

    expect(await within(screen.getByLabelText("Alert rules")).findByText("Critical errors")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Archive Critical errors" }));

    expect(confirm).toHaveBeenCalledWith("Archive alert rule Critical errors?");
    expect(archiveAlertRule).toHaveBeenCalledWith("rule_1");
    await waitFor(() => expect(within(screen.getByLabelText("Alert rules")).queryByText("Critical errors")).not.toBeInTheDocument());
    expect(within(screen.getByLabelText("Alert rules")).getByText("No alert rules.")).toBeInTheDocument();

    confirm.mockRestore();
  });

  it("archives a notification channel after confirmation and removes it from the channel list", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const archiveNotificationChannel = vi.fn().mockResolvedValue(undefined);
    const api = client({
      archiveNotificationChannel,
      listNotificationChannels: vi.fn().mockResolvedValue({
        channels: [
          {
            id: "chn_1",
            name: "Ops",
            type: "webhook",
            url: "https://hooks.example.com",
            emailRecipients: [],
            secretHeaderName: null,
            hasSecret: false,
            enabled: true,
            createdAt: "2026-05-06T11:00:00.000Z",
            updatedAt: "2026-05-06T11:00:00.000Z",
            archivedAt: null
          }
        ]
      })
    });

    render(<AlertsPanel client={api} projectId="prj_1" environmentId="env_1" />);

    expect(await within(screen.getByLabelText("Notification channels")).findByText("Ops")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Archive Ops" }));

    expect(confirm).toHaveBeenCalledWith("Archive notification channel Ops?");
    expect(archiveNotificationChannel).toHaveBeenCalledWith("chn_1");
    await waitFor(() => expect(within(screen.getByLabelText("Notification channels")).queryByText("Ops")).not.toBeInTheDocument());
    expect(within(screen.getByLabelText("Notification channels")).getByText("No notification channels.")).toBeInTheDocument();

    confirm.mockRestore();
  });

  it("creates a webhook channel without displaying the saved secret", async () => {
    const createNotificationChannel = vi.fn().mockResolvedValue({
      channel: {
        id: "chn_1",
        name: "Ops",
        type: "webhook",
        url: "https://hooks.example.com",
        secretHeaderName: "X-SignalMonitor-Secret",
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
    await userEvent.type(screen.getByLabelText("Secret header name"), "X-SignalMonitor-Secret");
    await userEvent.type(screen.getByLabelText("Secret header value"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Create channel" }));

    await waitFor(() =>
      expect(createNotificationChannel).toHaveBeenCalledWith({
        name: "Ops",
        type: "webhook",
        url: "https://hooks.example.com",
        secretHeaderName: "X-SignalMonitor-Secret",
        secretHeaderValue: "secret",
        enabled: true
      })
    );
    expect(screen.queryByDisplayValue("secret")).not.toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("Notification channels")).getByText("Secret saved")).toBeInTheDocument();
  });

  it("edits an existing webhook notification channel", async () => {
    const updateNotificationChannel = vi.fn().mockResolvedValue({
      channel: {
        id: "chn_1",
        name: "Ops updated",
        type: "webhook",
        url: "https://hooks.example.com/updated",
        emailRecipients: [],
        secretHeaderName: "X-SignalMonitor-Secret",
        hasSecret: true,
        enabled: true,
        createdAt: "",
        updatedAt: "",
        archivedAt: null
      }
    });
    const api = client({
      listNotificationChannels: vi.fn().mockResolvedValue({
        channels: [
          {
            id: "chn_1",
            name: "Ops",
            type: "webhook",
            url: "https://hooks.example.com",
            emailRecipients: [],
            secretHeaderName: "X-SignalMonitor-Secret",
            hasSecret: true,
            enabled: true,
            createdAt: "",
            updatedAt: "",
            archivedAt: null
          }
        ]
      }),
      updateNotificationChannel
    });

    render(<AlertsPanel client={api} projectId="prj_1" environmentId="env_1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit Ops" }));
    await userEvent.clear(screen.getByLabelText("Channel name"));
    await userEvent.type(screen.getByLabelText("Channel name"), "Ops updated");
    await userEvent.clear(screen.getByLabelText("Webhook URL"));
    await userEvent.type(screen.getByLabelText("Webhook URL"), "https://hooks.example.com/updated");
    await userEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() =>
      expect(updateNotificationChannel).toHaveBeenCalledWith("chn_1", {
        name: "Ops updated",
        type: "webhook",
        url: "https://hooks.example.com/updated",
        secretHeaderName: "X-SignalMonitor-Secret",
        enabled: true
      })
    );
    expect(within(screen.getByLabelText("Notification channels")).getByText("Ops updated")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create channel" })).toBeInTheDocument();
  });

  it("requires a secret header name before submitting a secret value", async () => {
    const createNotificationChannel = vi.fn();

    render(<AlertsPanel client={client({ createNotificationChannel })} projectId="prj_1" environmentId="env_1" />);

    await userEvent.type(await screen.findByLabelText("Channel name"), "Ops");
    await userEvent.type(screen.getByLabelText("Webhook URL"), "https://hooks.example.com");
    await userEvent.type(screen.getByLabelText("Secret header value"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Create channel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Secret header name is required when a secret value is set");
    expect(createNotificationChannel).not.toHaveBeenCalled();
  });

  it("creates an email notification channel", async () => {
    const createNotificationChannel = vi.fn().mockResolvedValue({
      channel: {
        id: "chn_email",
        name: "Ops email",
        type: "email",
        url: null,
        emailRecipients: ["diogo@example.com"],
        secretHeaderName: null,
        hasSecret: false,
        enabled: true,
        createdAt: "",
        updatedAt: "",
        archivedAt: null
      }
    });

    render(<AlertsPanel client={client({ createNotificationChannel })} projectId="prj_1" environmentId="env_1" />);

    await userEvent.selectOptions(await screen.findByLabelText("Channel type"), "email");
    await userEvent.type(screen.getByLabelText("Channel name"), "Ops email");
    await userEvent.type(screen.getByLabelText("Email recipients"), "diogo@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Create channel" }));

    await waitFor(() =>
      expect(createNotificationChannel).toHaveBeenCalledWith({
        name: "Ops email",
        type: "email",
        emailRecipients: ["diogo@example.com"],
        enabled: true
      })
    );
    expect(within(screen.getByLabelText("Notification channels")).getByText("SMTP delivery")).toBeInTheDocument();
  });

  it("rejects invalid webhook URLs before submitting a channel", async () => {
    const createNotificationChannel = vi.fn();

    render(<AlertsPanel client={client({ createNotificationChannel })} projectId="prj_1" environmentId="env_1" />);

    await userEvent.type(await screen.findByLabelText("Channel name"), "Ops");
    await userEvent.type(screen.getByLabelText("Webhook URL"), "ftp://hooks.example.com");
    await userEvent.click(screen.getByRole("button", { name: "Create channel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Webhook URL must be a valid http or https URL");
    expect(createNotificationChannel).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText("Webhook URL"));
    await userEvent.type(screen.getByLabelText("Webhook URL"), "https://user:pass@hooks.example.com");
    await userEvent.click(screen.getByRole("button", { name: "Create channel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Webhook URL must not include credentials");
    expect(createNotificationChannel).not.toHaveBeenCalled();
  });

  it("rejects invalid secret header names before submitting a channel", async () => {
    const createNotificationChannel = vi.fn();

    render(<AlertsPanel client={client({ createNotificationChannel })} projectId="prj_1" environmentId="env_1" />);

    await userEvent.type(await screen.findByLabelText("Channel name"), "Ops");
    await userEvent.type(screen.getByLabelText("Webhook URL"), "https://hooks.example.com");
    await userEvent.type(screen.getByLabelText("Secret header name"), "Authorization");
    await userEvent.click(screen.getByRole("button", { name: "Create channel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Secret header name must begin with X- or Sigmon-");
    expect(createNotificationChannel).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText("Secret header name"));
    await userEvent.type(screen.getByLabelText("Secret header name"), "X SignalMonitor Secret");
    await userEvent.click(screen.getByRole("button", { name: "Create channel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Secret header name may only contain letters, numbers, and hyphens");
    expect(createNotificationChannel).not.toHaveBeenCalled();
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
            emailRecipients: [],
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
    expect(screen.getByText("Error-rate thresholds are percentages. Trace p95 latency thresholds are milliseconds.")).toBeInTheDocument();
    expect(screen.getByText("Threshold is a count of critical or fatal errors in the window.")).toBeInTheDocument();
    expect(screen.getByLabelText("Window (minutes)")).toBeInTheDocument();
    expect(screen.getByLabelText("Threshold")).toBeInTheDocument();
    expect(screen.getByLabelText("Cooldown (minutes)")).toBeInTheDocument();
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

  it("edits an existing alert rule", async () => {
    const updateAlertRule = vi.fn().mockResolvedValue({
      rule: {
        id: "rule_1",
        projectId: "prj_1",
        environmentId: "env_1",
        notificationChannelId: "chn_1",
        name: "Critical errors updated",
        type: "error_count",
        severity: "warning",
        windowMinutes: 15,
        threshold: "3",
        cooldownMinutes: 45,
        enabled: true,
        lastEvaluatedAt: null,
        lastTriggeredAt: null,
        createdAt: "",
        updatedAt: "",
        archivedAt: null
      }
    });
    const api = client({
      listAlertRules: vi.fn().mockResolvedValue({
        rules: [
          {
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
        ]
      }),
      listNotificationChannels: vi.fn().mockResolvedValue({
        channels: [
          {
            id: "chn_1",
            name: "Ops",
            type: "email",
            url: null,
            emailRecipients: ["ops@example.com"],
            secretHeaderName: null,
            hasSecret: false,
            enabled: true,
            createdAt: "",
            updatedAt: "",
            archivedAt: null
          }
        ]
      }),
      updateAlertRule
    });

    render(<AlertsPanel client={api} projectId="prj_1" environmentId="env_1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit Critical errors" }));
    await userEvent.clear(screen.getByLabelText("Rule name"));
    await userEvent.type(screen.getByLabelText("Rule name"), "Critical errors updated");
    await userEvent.selectOptions(screen.getByLabelText("Rule type"), "error_count");
    await userEvent.selectOptions(screen.getByLabelText("Severity"), "warning");
    await userEvent.clear(screen.getByLabelText("Window (minutes)"));
    await userEvent.type(screen.getByLabelText("Window (minutes)"), "15");
    await userEvent.clear(screen.getByLabelText("Threshold"));
    await userEvent.type(screen.getByLabelText("Threshold"), "3");
    await userEvent.clear(screen.getByLabelText("Cooldown (minutes)"));
    await userEvent.type(screen.getByLabelText("Cooldown (minutes)"), "45");
    await userEvent.selectOptions(screen.getByLabelText("Notification channel"), "chn_1");
    await userEvent.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() =>
      expect(updateAlertRule).toHaveBeenCalledWith("rule_1", {
        projectId: "prj_1",
        environmentId: "env_1",
        notificationChannelId: "chn_1",
        name: "Critical errors updated",
        type: "error_count",
        severity: "warning",
        windowMinutes: 15,
        threshold: "3",
        cooldownMinutes: 45,
        enabled: true
      })
    );
    expect(within(screen.getByLabelText("Alert rules")).getByText("Critical errors updated")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create rule" })).toBeInTheDocument();
  });

  it("updates threshold help when selecting a unit-bearing alert rule type", async () => {
    const api = client();

    render(<AlertsPanel client={api} projectId="prj_1" environmentId="env_1" />);

    await screen.findByLabelText("Rule type");
    await userEvent.selectOptions(screen.getByLabelText("Rule type"), "trace_p95_latency");

    expect(screen.getByText("Error-rate thresholds are percentages. Trace p95 latency thresholds are milliseconds.")).toBeInTheDocument();
    expect(screen.getByText("Threshold is trace p95 latency in milliseconds.")).toBeInTheDocument();
  });

  it("does not render a stale created alert rule after switching environments", async () => {
    const pendingCreate = deferred<Awaited<ReturnType<ApiClient["createAlertRule"]>>>();
    const createAlertRule = vi.fn().mockReturnValue(pendingCreate.promise);
    const api = client({
      createAlertRule,
      listAlertRules: vi.fn().mockResolvedValue({ rules: [] }),
      listAlertEvents: vi.fn().mockResolvedValue({ data: [] })
    });

    const { rerender } = render(<AlertsPanel client={api} projectId="prj_1" environmentId="env_1" />);

    await userEvent.type(await screen.findByLabelText("Rule name"), "Env A critical errors");
    await userEvent.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() => expect(createAlertRule).toHaveBeenCalledWith(expect.objectContaining({ environmentId: "env_1" })));

    rerender(<AlertsPanel client={api} projectId="prj_1" environmentId="env_2" />);
    await waitFor(() => expect(api.listAlertRules).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_2" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());

    await act(async () => {
      pendingCreate.resolve({
        rule: {
          id: "rule_stale",
          projectId: "prj_1",
          environmentId: "env_1",
          notificationChannelId: null,
          name: "Env A critical errors",
          type: "critical_errors",
          severity: "critical",
          windowMinutes: 10,
          threshold: "1",
          cooldownMinutes: 30,
          routePattern: null,
          minimumSampleSize: 1,
          enabled: true,
          lastEvaluatedAt: null,
          lastTriggeredAt: null,
          createdAt: "",
          updatedAt: "",
          archivedAt: null
        }
      });
      await pendingCreate.promise;
    });

    expect(within(screen.getByLabelText("Alert rules")).queryByText("Env A critical errors")).not.toBeInTheDocument();
  });

  it("does not keep rule creation disabled in a new environment while the old create is pending", async () => {
    const pendingCreate = deferred<Awaited<ReturnType<ApiClient["createAlertRule"]>>>();
    const createAlertRule = vi.fn().mockReturnValue(pendingCreate.promise);
    const api = client({
      createAlertRule,
      listAlertRules: vi.fn().mockResolvedValue({ rules: [] }),
      listAlertEvents: vi.fn().mockResolvedValue({ data: [] })
    });

    const { rerender } = render(<AlertsPanel client={api} projectId="prj_1" environmentId="env_1" />);

    await userEvent.type(await screen.findByLabelText("Rule name"), "Env A critical errors");
    await userEvent.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() => expect(createAlertRule).toHaveBeenCalledWith(expect.objectContaining({ environmentId: "env_1" })));
    expect(screen.getByRole("button", { name: "Create rule" })).toBeDisabled();

    rerender(<AlertsPanel client={api} projectId="prj_1" environmentId="env_2" />);

    await waitFor(() => expect(api.listAlertRules).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_2" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Create rule" })).not.toBeDisabled();
  });

  it("clears scoped alert data while a new environment load is pending", async () => {
    const env2Rules = deferred<Awaited<ReturnType<ApiClient["listAlertRules"]>>>();
    const env2Channels = deferred<Awaited<ReturnType<ApiClient["listNotificationChannels"]>>>();
    const env2Events = deferred<Awaited<ReturnType<ApiClient["listAlertEvents"]>>>();
    const listAlertRules = vi
      .fn()
      .mockResolvedValueOnce({
        rules: [
          {
            id: "rule_env_1",
            projectId: "prj_1",
            environmentId: "env_1",
            notificationChannelId: "chn_env_1",
            name: "Env 1 stale rule",
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
        ]
      })
      .mockReturnValueOnce(env2Rules.promise);
    const listNotificationChannels = vi
      .fn()
      .mockResolvedValueOnce({
        channels: [
          {
            id: "chn_env_1",
            name: "Env 1 stale channel",
            type: "webhook",
            url: "https://hooks.example.com/env-1",
            emailRecipients: [],
            secretHeaderName: null,
            hasSecret: false,
            enabled: true,
            createdAt: "",
            updatedAt: "",
            archivedAt: null
          }
        ]
      })
      .mockReturnValueOnce(env2Channels.promise);
    const listAlertEvents = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            id: "evt_env_1",
            ruleId: "rule_env_1",
            monitorId: null,
            projectId: "prj_1",
            environmentId: "env_1",
            status: "triggered",
            severity: "critical",
            triggeredAt: "",
            windowStart: "",
            windowEnd: "",
            observedValue: "2",
            threshold: "1",
            message: "Env 1 stale event",
            metadata: {},
            createdAt: "",
            latestDeliveryStatus: "success"
          }
        ]
      })
      .mockReturnValueOnce(env2Events.promise);
    const api = client({ listAlertRules, listNotificationChannels, listAlertEvents });

    const { rerender } = render(<AlertsPanel client={api} projectId="prj_1" environmentId="env_1" />);

    expect(await screen.findByText("Env 1 stale rule")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Notification channels")).getByText("Env 1 stale channel")).toBeInTheDocument();
    expect(screen.getByText("Env 1 stale event")).toBeInTheDocument();

    rerender(<AlertsPanel client={api} projectId="prj_1" environmentId="env_2" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading alerts");
    expect(screen.queryByText("Env 1 stale rule")).not.toBeInTheDocument();
    expect(screen.queryByText("Env 1 stale channel")).not.toBeInTheDocument();
    expect(screen.queryByText("Env 1 stale event")).not.toBeInTheDocument();

    await act(async () => {
      env2Rules.resolve({
        rules: [
          {
            id: "rule_env_2",
            projectId: "prj_1",
            environmentId: "env_2",
            notificationChannelId: "chn_env_2",
            name: "Env 2 fresh rule",
            type: "error_count",
            severity: "warning",
            windowMinutes: 5,
            threshold: "3",
            cooldownMinutes: 15,
            routePattern: null,
            minimumSampleSize: 1,
            enabled: true,
            lastEvaluatedAt: null,
            lastTriggeredAt: null,
            createdAt: "",
            updatedAt: "",
            archivedAt: null
          }
        ]
      });
      env2Channels.resolve({
        channels: [
          {
            id: "chn_env_2",
            name: "Env 2 fresh channel",
            type: "webhook",
            url: "https://hooks.example.com/env-2",
            emailRecipients: [],
            secretHeaderName: null,
            hasSecret: false,
            enabled: true,
            createdAt: "",
            updatedAt: "",
            archivedAt: null
          }
        ]
      });
      env2Events.resolve({
        data: [
          {
            id: "evt_env_2",
            ruleId: "rule_env_2",
            monitorId: null,
            projectId: "prj_1",
            environmentId: "env_2",
            status: "triggered",
            severity: "warning",
            triggeredAt: "",
            windowStart: "",
            windowEnd: "",
            observedValue: "4",
            threshold: "3",
            message: "Env 2 fresh event",
            metadata: {},
            createdAt: "",
            latestDeliveryStatus: "success"
          }
        ]
      });
      await Promise.all([env2Rules.promise, env2Channels.promise, env2Events.promise]);
    });

    expect(await screen.findByText("Env 2 fresh rule")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Notification channels")).getByText("Env 2 fresh channel")).toBeInTheDocument();
    expect(screen.getByText("Env 2 fresh event")).toBeInTheDocument();
  });

  it("resets unsaved channel and rule fields when switching environments", async () => {
    const api = client({
      listNotificationChannels: vi.fn().mockResolvedValue({
        channels: [
          {
            id: "chn_1",
            name: "Ops",
            type: "webhook",
            url: "https://hooks.example.com",
            emailRecipients: [],
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

    const { rerender } = render(<AlertsPanel client={api} projectId="prj_1" environmentId="env_1" />);

    await userEvent.type(await screen.findByLabelText("Channel name"), "Unsaved channel");
    await userEvent.type(screen.getByLabelText("Webhook URL"), "https://hooks.example.com/unsaved");
    await userEvent.type(screen.getByLabelText("Secret header name"), "X-SignalMonitor-Secret");
    await userEvent.type(screen.getByLabelText("Secret header value"), "unsaved-secret");
    await userEvent.type(screen.getByLabelText("Rule name"), "Unsaved rule");
    await userEvent.clear(screen.getByLabelText("Window (minutes)"));
    await userEvent.type(screen.getByLabelText("Window (minutes)"), "15");
    await userEvent.clear(screen.getByLabelText("Threshold"));
    await userEvent.type(screen.getByLabelText("Threshold"), "3");
    await userEvent.clear(screen.getByLabelText("Cooldown (minutes)"));
    await userEvent.type(screen.getByLabelText("Cooldown (minutes)"), "45");
    await userEvent.selectOptions(screen.getByLabelText("Notification channel"), "chn_1");

    rerender(<AlertsPanel client={api} projectId="prj_1" environmentId="env_2" />);

    expect(await screen.findByLabelText("Channel name")).toHaveValue("");
    expect(screen.getByLabelText("Webhook URL")).toHaveValue("");
    expect(screen.getByLabelText("Secret header name")).toHaveValue("");
    expect(screen.getByLabelText("Secret header value")).toHaveValue("");
    expect(screen.getByLabelText("Rule name")).toHaveValue("");
    expect(screen.getByLabelText("Window (minutes)")).toHaveValue(10);
    expect(screen.getByLabelText("Threshold")).toHaveValue(1);
    expect(screen.getByLabelText("Cooldown (minutes)")).toHaveValue(30);
    expect(screen.getByLabelText("Notification channel")).toHaveValue("");
  });

  it("shows validation and skips channel creation when required channel fields are blank", async () => {
    const createNotificationChannel = vi.fn();

    render(<AlertsPanel client={client({ createNotificationChannel })} projectId="prj_1" environmentId="env_1" />);

    await screen.findByLabelText("Channel name");
    await userEvent.click(screen.getByRole("button", { name: "Create channel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Channel name is required");
    expect(createNotificationChannel).not.toHaveBeenCalled();
  });

  it("shows validation and skips rule creation when the rule name is blank", async () => {
    const createAlertRule = vi.fn();

    render(<AlertsPanel client={client({ createAlertRule })} projectId="prj_1" environmentId="env_1" />);

    await screen.findByLabelText("Rule name");
    await userEvent.click(screen.getByRole("button", { name: "Create rule" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Rule name is required");
    expect(createAlertRule).not.toHaveBeenCalled();
  });

  it("blocks blank and invalid numeric alert rule values before submitting", async () => {
    const createAlertRule = vi.fn();

    render(<AlertsPanel client={client({ createAlertRule })} projectId="prj_1" environmentId="env_1" />);

    await userEvent.type(await screen.findByLabelText("Rule name"), "Critical errors");
    await userEvent.clear(screen.getByLabelText("Window (minutes)"));
    await userEvent.click(screen.getByRole("button", { name: "Create rule" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Window must be a whole number of at least 1 minute");
    expect(createAlertRule).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Window (minutes)"), "10");
    await userEvent.clear(screen.getByLabelText("Threshold"));
    await userEvent.type(screen.getByLabelText("Threshold"), "1.1234567");
    await userEvent.click(screen.getByRole("button", { name: "Create rule" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Threshold must be a positive number with up to 6 decimal places");
    expect(createAlertRule).not.toHaveBeenCalled();
  });

  it("disables create buttons while alerts are loading", () => {
    const alertRules = deferred<{ rules: [] }>();
    const notificationChannels = deferred<{ channels: [] }>();
    const alertEvents = deferred<{ data: [] }>();

    render(
      <AlertsPanel
        client={client({
          listAlertRules: vi.fn().mockReturnValue(alertRules.promise),
          listNotificationChannels: vi.fn().mockReturnValue(notificationChannels.promise),
          listAlertEvents: vi.fn().mockReturnValue(alertEvents.promise)
        })}
        projectId="prj_1"
        environmentId="env_1"
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading alerts");
    expect(screen.getByRole("button", { name: "Create channel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create rule" })).toBeDisabled();
  });

  it("shows a compact empty state without project or environment", () => {
    const api = client();

    render(<AlertsPanel client={api} />);

    expect(screen.getByRole("heading", { name: "Alerts" })).toBeInTheDocument();
    expect(screen.getByText("Select a project and environment to manage alerts.")).toBeInTheDocument();
    expect(api.listAlertRules).not.toHaveBeenCalled();
  });
});
