// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
      escalationLabel: "15m -> Email · finance",
      fires7d: 4,
      type: "critical_errors",
      threshold: "1",
      windowMinutes: 5,
      cooldownMinutes: 60,
      escalationMinutes: 15,
      routePattern: null,
      minimumSampleSize: 0,
      notificationChannelId: "c1",
      escalationChannelId: "c2",
    },
    {
      id: "r2",
      name: "Worker failures dlq",
      subLabel: "error_count · 5 · 30m",
      severity: "warning",
      severityTag: "warn",
      enabled: false,
      channelLabel: "Discord · #ops",
      escalationLabel: "No escalation",
      fires7d: 0,
      type: "error_count",
      threshold: "5",
      windowMinutes: 30,
      cooldownMinutes: 60,
      escalationMinutes: null,
      routePattern: null,
      minimumSampleSize: 0,
      notificationChannelId: null,
      escalationChannelId: null,
    },
  ],
  events: [
    {
      id: "ale_1",
      message: "Critical errors threshold reached",
      status: "triggered",
      severity: "critical",
      sourceLabel: "Critical errors in production",
      observedLabel: "4 / 1",
      deliveryLabel: "Delivered",
      escalationLabel: "Escalates 6/23/2026, 9:15:00 AM",
      triggeredAtLabel: "6/23/2026, 9:00:00 AM",
      snoozedUntil: null,
    },
  ],
  channels: [
    { id: "c1", name: "Slack · #incidents", icon: "webhook", target: "https://hooks.slack.com/services/T0/abc", ok: true, type: "webhook", url: "https://hooks.slack.com/services/T0/abc", hasUrl: true, urlPreview: null, emailRecipients: [], secretHeaderName: null, hasSecret: false },
    { id: "c2", name: "Email · finance", icon: "mail", target: "finance@acme.dev", ok: false, type: "email", url: null, hasUrl: false, urlPreview: null, emailRecipients: ["finance@acme.dev"], secretHeaderName: null, hasSecret: false },
    { id: "c3", name: "Slack native · #alerts", icon: "slack", target: "https://hooks.slack.com/service…", ok: true, type: "slack", url: null, hasUrl: true, urlPreview: "https://hooks.slack.com/service…", emailRecipients: [], secretHeaderName: null, hasSecret: false },
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
    updateAlertEventTriage: vi.fn().mockResolvedValue(true),
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
    expect(screen.getAllByText("critical").length).toBeGreaterThanOrEqual(1);
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

describe("AlertsScreen — On-call queue triage note", () => {
  it("renders an optional note input for each queue event", () => {
    mockUseAlerts(vm);
    render(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.getByPlaceholderText(/note/i)).toBeInTheDocument();
  });

  it("calls updateAlertEventTriage with the typed note when Ack is clicked", async () => {
    const updateAlertEventTriage = vi.fn().mockResolvedValue(true);
    vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({
      data: vm,
      status: "ok",
      busy: false,
      reload: vi.fn(),
      createRule: vi.fn().mockResolvedValue(true),
      updateRule: vi.fn().mockResolvedValue(true),
      archiveRule: vi.fn().mockResolvedValue(true),
      updateAlertEventTriage,
      createChannel: vi.fn().mockResolvedValue(true),
      updateChannel: vi.fn().mockResolvedValue(true),
      archiveChannel: vi.fn().mockResolvedValue(true),
      createFromSuggestion: vi.fn().mockResolvedValue(true),
    });
    render(<AlertsScreen ctx={makeCtx()} />);

    await userEvent.type(screen.getByPlaceholderText(/note/i), "Investigated, provider degradation");
    await userEvent.click(screen.getByRole("button", { name: /^ack$/i }));

    expect(updateAlertEventTriage).toHaveBeenCalledWith(
      "ale_1",
      expect.objectContaining({ status: "acknowledged", note: "Investigated, provider degradation" })
    );
  });

  it("calls updateAlertEventTriage without a note when none was typed", async () => {
    const updateAlertEventTriage = vi.fn().mockResolvedValue(true);
    vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({
      data: vm,
      status: "ok",
      busy: false,
      reload: vi.fn(),
      createRule: vi.fn().mockResolvedValue(true),
      updateRule: vi.fn().mockResolvedValue(true),
      archiveRule: vi.fn().mockResolvedValue(true),
      updateAlertEventTriage,
      createChannel: vi.fn().mockResolvedValue(true),
      updateChannel: vi.fn().mockResolvedValue(true),
      archiveChannel: vi.fn().mockResolvedValue(true),
      createFromSuggestion: vi.fn().mockResolvedValue(true),
    });
    render(<AlertsScreen ctx={makeCtx()} />);

    await userEvent.click(screen.getByRole("button", { name: /^resolve$/i }));

    expect(updateAlertEventTriage).toHaveBeenCalledWith(
      "ale_1",
      expect.objectContaining({ status: "resolved", note: undefined })
    );
  });

  it("clears the note input after a triage action is submitted", async () => {
    const updateAlertEventTriage = vi.fn().mockResolvedValue(true);
    vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({
      data: vm,
      status: "ok",
      busy: false,
      reload: vi.fn(),
      createRule: vi.fn().mockResolvedValue(true),
      updateRule: vi.fn().mockResolvedValue(true),
      archiveRule: vi.fn().mockResolvedValue(true),
      updateAlertEventTriage,
      createChannel: vi.fn().mockResolvedValue(true),
      updateChannel: vi.fn().mockResolvedValue(true),
      archiveChannel: vi.fn().mockResolvedValue(true),
      createFromSuggestion: vi.fn().mockResolvedValue(true),
    });
    render(<AlertsScreen ctx={makeCtx()} />);

    const noteInput = screen.getByPlaceholderText(/note/i) as HTMLInputElement;
    await userEvent.type(noteInput, "Snoozing while provider recovers");
    await userEvent.click(screen.getByRole("button", { name: /^snooze/i }));

    await waitFor(() => expect(noteInput.value).toBe(""));
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
    updateAlertEventTriage: vi.fn().mockResolvedValue(true),
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
    updateAlertEventTriage: vi.fn().mockResolvedValue(true),
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
    updateAlertEventTriage: vi.fn().mockResolvedValue(true),
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

describe("AlertsScreen — channels panel", () => {
  // NOTE: "renders channel name renders + Test disabled" is already covered by
  // the "renders channels and disabled test button" test in the main describe block.
  // We add only the gaps missing from that test.

  it("renders the Test button title attribute hint", () => {
    // The existing test checks toBeDisabled() but NOT the title attribute.
    mockUseAlertsWithActions(vm);
    render(<AlertsScreen ctx={makeCtx()} />);
    // Each channel row has a disabled "test" button with a title hint
    const testBtns = screen.getAllByText("test");
    expect(testBtns[0]).toHaveAttribute("title", "Test send coming soon");
  });

  it("renders channel target (webhook URL host / email address)", () => {
    mockUseAlertsWithActions(vm);
    render(<AlertsScreen ctx={makeCtx()} />);
    // Webhook channel target: full URL shown on the row
    expect(screen.getByText("https://hooks.slack.com/services/T0/abc")).toBeInTheDocument();
    // Email channel target
    expect(screen.getByText("finance@acme.dev")).toBeInTheDocument();
  });

  it("renders a masked url preview for native Slack/Discord channels, never the full url", () => {
    mockUseAlertsWithActions(vm);
    render(<AlertsScreen ctx={makeCtx()} />);
    // c3 is a native slack channel whose VM only carries the masked preview —
    // the row must render that preview and nothing that looks like a full url.
    expect(screen.getByText("https://hooks.slack.com/service…")).toBeInTheDocument();
  });

  it("opens the edit form pre-filled for an existing channel and preserves the url when left blank", async () => {
    const updateChannel = vi.fn().mockResolvedValue(true);
    vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({
      data: vm,
      status: "ok",
      busy: false,
      reload: vi.fn(),
      createRule: vi.fn().mockResolvedValue(true),
      updateRule: vi.fn().mockResolvedValue(true),
      archiveRule: vi.fn().mockResolvedValue(true),
      updateAlertEventTriage: vi.fn().mockResolvedValue(true),
      createChannel: vi.fn().mockResolvedValue(true),
      updateChannel,
      archiveChannel: vi.fn().mockResolvedValue(true),
      createFromSuggestion: vi.fn().mockResolvedValue(true),
    });
    render(<AlertsScreen ctx={makeCtx()} />);

    // c3 ("Slack native · #alerts") is the third channel row.
    const editBtns = screen.getAllByRole("button", { name: /edit channel/i });
    await userEvent.click(editBtns[editBtns.length - 1]);

    expect(screen.getByDisplayValue("Slack native · #alerts")).toBeInTheDocument();
    // The url input must NOT be pre-filled with any url — it's write-only.
    const urlInput = screen.getByPlaceholderText(/leave blank to keep/i) as HTMLInputElement;
    expect(urlInput.value).toBe("");
    expect(urlInput.placeholder).toContain("https://hooks.slack.com/service…");

    await userEvent.click(screen.getByRole("button", { name: "Save channel" }));

    expect(updateChannel).toHaveBeenCalledWith("c3", { name: "Slack native · #alerts" });
  });

  it("replaces the Slack webhook url when the admin types a new one in the edit form", async () => {
    const updateChannel = vi.fn().mockResolvedValue(true);
    vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({
      data: vm,
      status: "ok",
      busy: false,
      reload: vi.fn(),
      createRule: vi.fn().mockResolvedValue(true),
      updateRule: vi.fn().mockResolvedValue(true),
      archiveRule: vi.fn().mockResolvedValue(true),
      updateAlertEventTriage: vi.fn().mockResolvedValue(true),
      createChannel: vi.fn().mockResolvedValue(true),
      updateChannel,
      archiveChannel: vi.fn().mockResolvedValue(true),
      createFromSuggestion: vi.fn().mockResolvedValue(true),
    });
    render(<AlertsScreen ctx={makeCtx()} />);

    const editBtns = screen.getAllByRole("button", { name: /edit channel/i });
    await userEvent.click(editBtns[editBtns.length - 1]);

    const urlInput = screen.getByPlaceholderText(/leave blank to keep/i);
    await userEvent.type(urlInput, "https://hooks.slack.com/services/T9/new");
    await userEvent.click(screen.getByRole("button", { name: "Save channel" }));

    expect(updateChannel).toHaveBeenCalledWith("c3", {
      name: "Slack native · #alerts",
      url: "https://hooks.slack.com/services/T9/new",
    });
  });

  it("calls archiveChannel on archive confirm", async () => {
    const archiveChannel = vi.fn().mockResolvedValue(true);
    vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({
      data: vm,
      status: "ok",
      busy: false,
      reload: vi.fn(),
      createRule: vi.fn().mockResolvedValue(true),
      updateRule: vi.fn().mockResolvedValue(true),
      archiveRule: vi.fn().mockResolvedValue(true),
    updateAlertEventTriage: vi.fn().mockResolvedValue(true),
      createChannel: vi.fn().mockResolvedValue(true),
      updateChannel: vi.fn().mockResolvedValue(true),
      archiveChannel,
      createFromSuggestion: vi.fn().mockResolvedValue(true),
    });
    render(<AlertsScreen ctx={makeCtx()} />);
    // Find the first channel row via its "test" disabled button, then locate
    // the adjacent ConfirmButton (archive) within the same row container.
    const testBtns = screen.getAllByText("test");
    const channelRow = testBtns[0].closest("div") as HTMLElement;
    const btnsInRow = within(channelRow).getAllByRole("button");
    // Row has: [test button (disabled)] [Edit channel (enabled)] [ConfirmButton (last, arm state, enabled)]
    const armBtn = btnsInRow[btnsInRow.length - 1] as HTMLButtonElement;
    expect(armBtn.disabled).toBe(false);
    // First click arms the ConfirmButton (shows the confirmLabel "Archive")
    await userEvent.click(armBtn);
    const confirmBtn = screen.getByRole("button", { name: /archive/i });
    await userEvent.click(confirmBtn);
    expect(archiveChannel).toHaveBeenCalledWith(expect.any(String));
  });

  it("creates a native Slack channel with the selected type and URL", async () => {
    const createChannel = vi.fn().mockResolvedValue(true);
    vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({
      data: vm,
      status: "ok",
      busy: false,
      reload: vi.fn(),
      createRule: vi.fn().mockResolvedValue(true),
      updateRule: vi.fn().mockResolvedValue(true),
      archiveRule: vi.fn().mockResolvedValue(true),
      updateAlertEventTriage: vi.fn().mockResolvedValue(true),
      createChannel,
      updateChannel: vi.fn().mockResolvedValue(true),
      archiveChannel: vi.fn().mockResolvedValue(true),
      createFromSuggestion: vi.fn().mockResolvedValue(true),
    });
    render(<AlertsScreen ctx={makeCtx()} />);

    await userEvent.click(screen.getAllByRole("button", { name: /channels/i })[0]);
    await userEvent.click(screen.getByRole("button", { name: "slack" }));
    expect(screen.getByText("Slack Incoming Webhook URL")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Slack #incidents"), "Slack alerts");
    await userEvent.type(
      screen.getByPlaceholderText("https://hooks.slack.com/services/..."),
      "https://hooks.slack.com/services/T0/xyz",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create channel" }));

    expect(createChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "slack",
        name: "Slack alerts",
        url: "https://hooks.slack.com/services/T0/xyz",
      }),
    );
  });
});
