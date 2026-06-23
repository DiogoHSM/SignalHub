// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../api/types";
import { AlertsScreen } from "./AlertsScreen";
import type { ScreenCtx } from "./registry";
import * as useAlertsModule from "./useAlerts";
import type { AlertsVM } from "./useAlerts";

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
    },
  ],
  channels: [
    { id: "c1", name: "Slack · #incidents", icon: "webhook", target: "https://hooks.slack.com/services/T0/abc", ok: true },
    { id: "c2", name: "Email · finance", icon: "mail", target: "finance@acme.dev", ok: false },
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
};

function mockUseAlerts(data: AlertsVM | null, status: "loading" | "ok" | "error" = "ok") {
  vi.spyOn(useAlertsModule, "useAlerts").mockReturnValue({ data, status, reload: vi.fn() });
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

  it("renders channels and fires test / new-rule toasts", async () => {
    mockUseAlerts(vm);
    const ctx = makeCtx();
    render(<AlertsScreen ctx={ctx} />);
    // channel name appears in the rule channel column AND the channel card
    expect(screen.getAllByText("Slack · #incidents").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Email · finance")).toBeInTheDocument();
    await userEvent.click(screen.getAllByText("test")[0]);
    expect(ctx.pushToast).toHaveBeenCalledWith("Test notification sent to Slack · #incidents");
    await userEvent.click(screen.getByText("New rule"));
    expect(ctx.pushToast).toHaveBeenCalledWith("Rule editor is not yet available");
  });

  it("shows an empty hint when there are no rules", () => {
    mockUseAlerts({ ...vm, rules: [] });
    render(<AlertsScreen ctx={makeCtx()} />);
    expect(screen.getByText("No alert rules")).toBeInTheDocument();
  });
});
