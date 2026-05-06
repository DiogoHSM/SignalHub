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
        secretHeaderName: "X-SignalHub-Secret",
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

  it("shows validation and skips channel creation when required channel fields are blank", async () => {
    const createNotificationChannel = vi.fn();

    render(<AlertsPanel client={client({ createNotificationChannel })} projectId="prj_1" environmentId="env_1" />);

    await screen.findByLabelText("Channel name");
    await userEvent.click(screen.getByRole("button", { name: "Create channel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Channel name and webhook URL are required");
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
    await userEvent.clear(screen.getByLabelText("Window"));
    await userEvent.click(screen.getByRole("button", { name: "Create rule" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Window must be a whole number of at least 1 minute");
    expect(createAlertRule).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Window"), "10");
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
