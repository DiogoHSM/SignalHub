// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../api/types";
import { AlertsScreen } from "./AlertsScreen";
import type { ScreenCtx } from "./registry";
import * as useAlertsModule from "./useAlerts";
import type { AlertsVM } from "./useAlerts";
import type { SuggestionRowVM } from "./useAlerts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project = { id: "p", name: "Demo" } as Project;
const environment = { id: "e", name: "production" } as Environment;

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: {} as never,
    project,
    environment,
    environments: [environment],
    onCreateEnvironment: vi.fn(),
    onArchiveProject: vi.fn(),
    onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(),
    onUpdateProject: vi.fn(),
    navigate: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
    ...over,
  } as ScreenCtx;
}

const vm: AlertsVM = {
  header: { activeRuleCount: 2, fires7d: 5 },
  rules: [
    {
      id: "r1",
      name: "Critical errors in production",
      subLabel: "critical_errors · 1 · 5m",
      severity: "critical",
      severityTag: "critical",
      enabled: true,
      channelLabel: "Slack · #incidents",
      fires7d: 4,
      type: "critical_errors",
      threshold: "1",
      windowMinutes: 5,
      cooldownMinutes: 60,
      routePattern: null,
      minimumSampleSize: 0,
      notificationChannelId: "c1",
    },
    {
      id: "r2",
      name: "Worker failures dlq",
      subLabel: "error_count · 5 · 30m",
      severity: "warning",
      severityTag: "warn",
      enabled: false,
      channelLabel: "Discord · #ops",
      fires7d: 0,
      type: "error_count",
      threshold: "5",
      windowMinutes: 30,
      cooldownMinutes: 60,
      routePattern: null,
      minimumSampleSize: 0,
      notificationChannelId: null,
    },
  ],
  channels: [
    { id: "c1", name: "Slack · #incidents", icon: "webhook", target: "https://hooks.slack.com/services/T0/abc", ok: true, type: "webhook", url: "https://hooks.slack.com/services/T0/abc", emailRecipients: [], secretHeaderName: null, hasSecret: false },
    { id: "c2", name: "Email · finance", icon: "mail", target: "finance@acme.dev", ok: false, type: "email", url: null, emailRecipients: ["finance@acme.dev"], secretHeaderName: null, hasSecret: false },
  ],
  timeline: [
    { label: "Wed 17", fires: [] },
    { label: "Thu 18", fires: [{ hourFraction: 0.5, tone: "warn" }] },
    { label: "Fri 19", fires: [] },
    { label: "Sat 20", fires: [] },
    { label: "Sun 21", fires: [] },
    { label: "Mon 22", fires: [{ hourFraction: 0.25, tone: "critical" }] },
    { label: "Tue 23", fires: [{ hourFraction: 0.7, tone: "critical" }] },
  ],
  suggestions: [],
};

function mockUseAlerts(data: AlertsVM | null, status: "loading" | "ok" | "error" = "ok") {
  vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({
    data,
    status,
    busy: false,
    reload: vi.fn(),
    createRule: vi.fn().mockResolvedValue(true),
    updateRule: vi.fn().mockResolvedValue(true),
    archiveRule: vi.fn().mockResolvedValue(true),
    createChannel: vi.fn().mockResolvedValue(true),
    updateChannel: vi.fn().mockResolvedValue(true),
    archiveChannel: vi.fn().mockResolvedValue(true),
    createFromSuggestion: vi.fn().mockResolvedValue(true),
  });
}

describe("AlertsScreen", () => {
  it("shows a guard hint when project/env are missing", () => {
    mockUseAlerts(null, "loading");
    render(<AlertsScreen ctx={makeCtx({ project: undefined, environment: undefined })} />);
    expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
  });

  it("shows loading and error states", () => {
    mockUseAlerts(null, "loading");
    const { rerender } = render(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    mockUseAlerts(null, "error");
    rerender(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.getByText(/could not load/i)).toBeInTheDocument();
  });

  it("renders the page head with active-rule and fires counts", () => {
    mockUseAlerts(vm);
    render(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.getByText("Alerts")).toBeInTheDocument();
    expect(screen.getByText("2 active rules · 5 fires in the last 7 days")).toBeInTheDocument();
    expect(screen.getByText("New rule")).toBeInTheDocument();
    // "Channels" appears in the head action button AND the right-card head
    expect(screen.getAllByText("Channels").length).toBeGreaterThanOrEqual(2);
  });

  it("renders a rule row with severity, state, channel, and 7d count", () => {
    mockUseAlerts(vm);
    render(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.getByText("Critical errors in production")).toBeInTheDocument();
    expect(screen.getByText("critical_errors · 1 · 5m")).toBeInTheDocument();
    // severity DOM text is lowercase (uppercased only via CSS)
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByText("● active")).toBeInTheDocument();
    expect(screen.getByText("paused")).toBeInTheDocument();
  });

  it("filters rules to paused via the Segmented control", async () => {
    mockUseAlerts(vm);
    render(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.getByText("Critical errors in production")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Paused"));
    expect(screen.queryByText("Critical errors in production")).not.toBeInTheDocument();
    expect(screen.getByText("Worker failures dlq")).toBeInTheDocument();
  });

  it("renders channels and disabled test button", async () => {
    mockUseAlerts(vm);
    const ctx = makeCtx();
    render(<AlertsScreen ctx={ctx} />);
    // channel name appears in the rule channel column AND the channel card
    expect(screen.getAllByText("Slack · #incidents").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Email · finance")).toBeInTheDocument();
    // test button is disabled affordance
    const testBtn = screen.getAllByText("test")[0];
    expect(testBtn).toBeDisabled();
  });

  it("shows an empty hint when there are no rules", () => {
    mockUseAlerts({ ...vm, rules: [] });
    render(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.getByText("No alert rules")).toBeInTheDocument();
  });
});

// extend existing vm to include suggestions
const vmWithSuggestions: AlertsVM = {
  ...vm,
  suggestions: [
    {
      key: "critical_errors",
      type: "critical_errors",
      severity: "critical",
      title: "Critical errors detected",
      sub: "3 in 24h",
      windowMinutes: 60,
      threshold: "1",
      cooldownMinutes: 60,
      rationale: "rationale text",
    } as SuggestionRowVM,
  ],
};

// Update mockUseAlerts to also return action stubs
function mockUseAlertsWithActions(data: AlertsVM | null, status: "loading" | "ok" | "error" = "ok") {
  vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({
    data,
    status,
    busy: false,
    reload: vi.fn(),
    createRule: vi.fn().mockResolvedValue(true),
    updateRule: vi.fn().mockResolvedValue(true),
    archiveRule: vi.fn().mockResolvedValue(true),
    createChannel: vi.fn().mockResolvedValue(true),
    updateChannel: vi.fn().mockResolvedValue(true),
    archiveChannel: vi.fn().mockResolvedValue(true),
    createFromSuggestion: vi.fn().mockResolvedValue(true),
  });
}

describe("AlertsScreen — Suggestions card", () => {
  it("renders suggestion title and Create button", () => {
    mockUseAlertsWithActions({ ...vmWithSuggestions, rules: [], channels: [] });
    render(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.getByText("Critical errors detected")).toBeInTheDocument();
    expect(screen.getByText("3 in 24h")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
  });

  it("calls createFromSuggestion on Create click and toasts success", async () => {
    const spy = vi.fn().mockResolvedValue(true);
    vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({
      data: { ...vmWithSuggestions, rules: [], channels: [] },
      status: "ok",
      busy: false,
      reload: vi.fn(),
      createRule: vi.fn().mockResolvedValue(true),
      updateRule: vi.fn().mockResolvedValue(true),
      archiveRule: vi.fn().mockResolvedValue(true),
      createChannel: vi.fn().mockResolvedValue(true),
      updateChannel: vi.fn().mockResolvedValue(true),
      archiveChannel: vi.fn().mockResolvedValue(true),
      createFromSuggestion: spy,
    });
    const ctx = makeCtx();
    render(<AlertsScreen ctx={ctx} />);
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(spy).toHaveBeenCalledOnce();
    await waitFor(() => expect(ctx.pushToast).toHaveBeenCalledWith(expect.stringContaining("created")));
  });

  it("shows no suggestions card when suggestions are empty", () => {
    mockUseAlertsWithActions({ ...vm, suggestions: [] });
    render(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
  });
});

describe("AlertsScreen — pause/resume and archive", () => {
  it("pause button calls updateRule with enabled: false", async () => {
    const updateRule = vi.fn().mockResolvedValue(true);
    vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({
      data: { ...vm, suggestions: [] },
      status: "ok",
      busy: false,
      reload: vi.fn(),
      createRule: vi.fn().mockResolvedValue(true),
      updateRule,
      archiveRule: vi.fn().mockResolvedValue(true),
      createChannel: vi.fn().mockResolvedValue(true),
      updateChannel: vi.fn().mockResolvedValue(true),
      archiveChannel: vi.fn().mockResolvedValue(true),
      createFromSuggestion: vi.fn().mockResolvedValue(true),
    });
    const ctx = makeCtx();
    render(<AlertsScreen ctx={ctx} />);
    // First rule row is "Critical errors in production" which is enabled
    const pauseButtons = screen.getAllByTitle("Pause");
    await userEvent.click(pauseButtons[0]);
    expect(updateRule).toHaveBeenCalledWith("r1", { enabled: false });
  });
});
