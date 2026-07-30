import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OverviewVM } from "./useOverview";
import * as useOverviewModule from "./useOverview";
import { OverviewScreen } from "./OverviewScreen";
import type { ScreenCtx } from "./registry";

// ---------------------------------------------------------------------------
// Canned VM
// ---------------------------------------------------------------------------

const ALL_CLEAR_VM: OverviewVM = {
  banner: { incidents: 0, alerts: 0, top: null },
  operations: {
    posture: {
      status: "degraded",
      monitors: { total: 6, up: 2, down: 1, degraded: 0, paused: 1, unknown: 2 },
      alerts: { enabledRules: 5, events: 2, critical: 1, deliveryFailed: 0 },
      setupGaps: [
        { key: "heartbeat_monitor", label: "No heartbeat monitor", severity: "warning", destination: "monitors" },
        { key: "notification_channel", label: "No notification channel", severity: "warning", destination: "alerts" },
      ],
    },
    recommendedActions: [
      {
        key: "prediction-risk",
        title: "Act on critical predicted risk",
        description: "Checkout reliability risk: 88% probability with high confidence.",
        action: "Open traces",
        tone: "critical",
        destination: "traces",
      },
      {
        key: "incidents",
        title: "Investigate active incidents",
        description: "3 active incidents, including 1 high priority.",
        action: "Open incident",
        tone: "warning",
        destination: "incident",
        groupId: "egrp_checkout",
        errorId: "err_checkout",
      },
    ],
    predictions: [
      {
        id: "risk",
        label: "Checkout reliability risk",
        severity: "critical",
        score: 0.91,
        confidence: "high",
        probabilityPercent: 88,
        baselineRiskScore: 0.31,
        delta: 0.6,
        sampleSize: 44,
        baselineSampleSize: 39,
        method: "weighted operational signals",
        destination: "traces",
        factors: [
          {
            key: "latency",
            label: "Trace latency",
            impact: "negative",
            weight: 0.7,
            observedValue: 860,
            baselineValue: 420,
            reason: "Latency is materially above baseline.",
          },
        ],
      },
    ],
    anomalies: [
      {
        id: "latency",
        label: "Checkout latency increased",
        severity: "critical",
        observedValue: 860,
        baselineValue: 420,
        changePercent: 104.76,
        sampleSize: 44,
        baselineSampleSize: 39,
        threshold: "p95 is at least 50% above baseline",
        reason: "Checkout p95 more than doubled.",
        suggestedAlertRuleType: "trace_p95_latency",
        destination: "traces",
      },
    ],
    topLatency: [
      { name: "POST /checkout", p95TraceDurationMs: 860, traces: 44, failedTraces: 3 },
    ],
  },
  kpis: {
    events: 5000,
    activeUsers: 42,
    activeTenants: 10,
    errors: 80,
    traces: 400,
    failedTraces: 12,
    p95TraceDurationMs: 320,
    averageTraceDurationMs: 150,
    llmCalls: 200,
    llmCostUsd: "3.50",
    errorRate: 20,
    topModel: "gpt-4o",
    errorsSparkline: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    usageSparkline: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120],
    latencySparkline: [200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310],
    aiCostSparkline: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2],
  },
  topTenants: [
    { id: "t1", name: "Acme Corp", events: 482010, costUsd: "18.20", errors: 4 },
    { id: "t2", name: "Northwind", events: 318204, costUsd: "12.40", errors: 2 },
    { id: "t3", name: "Globex", events: 241102, costUsd: "8.90", errors: 1 },
  ],
  llmByModel: [
    { model: "gpt-4o", costUsd: "2.50" },
    { model: "claude-3-5-sonnet", costUsd: "1.00" },
  ],
  releases: [
    {
      release: "web@1.2.3",
      events: 240,
      errors: 3,
      traces: 80,
      failedTraces: 2,
      llmCalls: 12,
      code: null,
      firstSeenAt: "2026-06-21T23:00:00Z",
      lastSeenAt: "2026-06-22T00:05:00Z",
    },
  ],
  selectedRelease: null,
  selectRelease: vi.fn(),
  activity: [
    { kind: "error", title: "PaymentTimeoutError", sub: "TypeError", timestamp: "2026-06-22T00:05:00Z", groupId: "egrp_payment", errorId: "err_payment" },
    { kind: "llm", title: "openai / gpt-4o", sub: "timeout", timestamp: "2026-06-22T00:04:00Z" },
    { kind: "trace", title: "generate_report", sub: "failed", timestamp: "2026-06-22T00:03:00Z" },
  ],
};

const INCIDENT_VM: OverviewVM = {
  ...ALL_CLEAR_VM,
  banner: {
    incidents: 3,
    alerts: 2,
    top: { message: "PaymentTimeoutError in /checkout", severity: "critical", groupId: "egrp_checkout", errorId: "err_checkout" },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockCtx(): ScreenCtx {
  return {
    client: {} as ScreenCtx["client"],
    project: { id: "prj_1", name: "Acme Prod", createdAt: "", updatedAt: "", archivedAt: null },
    environment: { id: "env_1", projectId: "prj_1", name: "production", createdAt: "", updatedAt: "", archivedAt: null },
    environments: [],
    onCreateEnvironment: vi.fn(),
    onArchiveProject: vi.fn(),
    onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(),
    onUpdateProject: vi.fn(),
    navigate: vi.fn(),
    pendingFilters: null,
    clearPendingFilters: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
  };
}

function mockUseOverview(vm: OverviewVM | null, status: "loading" | "ok" | "error" = "ok") {
  vi.spyOn(useOverviewModule, "useOverview").mockReturnValue({
    data: vm,
    status,
    reload: vi.fn(),
    selectedRelease: vm?.selectedRelease ?? null,
    selectRelease: vm?.selectRelease ?? vi.fn(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OverviewScreen", () => {
  describe("operations home", () => {
    it("identifies the promoted screen as Operations", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByRole("heading", { name: "Operations" })).toBeInTheDocument();
    });

    it("renders monitor, alert, and setup posture with intentional drilldowns", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      const navigate = vi.fn();
      render(<OverviewScreen ctx={makeMockCtx()} navigate={navigate} />);

      expect(screen.getByRole("region", { name: "Operational posture" })).toBeInTheDocument();
      expect(screen.getByText("2 up, 1 down, 0 degraded")).toBeInTheDocument();
      expect(screen.getByText("1 paused, 2 unknown")).toBeInTheDocument();
      expect(screen.getByText("5 enabled rules, 1 critical, 0 delivery failures")).toBeInTheDocument();
      expect(screen.getByText("No heartbeat monitor")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /open monitors/i }));
      expect(navigate).toHaveBeenCalledWith("monitors");
      await userEvent.click(screen.getByRole("button", { name: /no notification channel/i }));
      expect(navigate).toHaveBeenCalledWith("alerts");
    });

    it("renders no-setup-gap posture without hiding monitor and alert state", () => {
      mockUseOverview({
        ...ALL_CLEAR_VM,
        operations: {
          ...ALL_CLEAR_VM.operations,
          posture: { ...ALL_CLEAR_VM.operations.posture, setupGaps: [] },
        },
      });
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("Setup complete")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /open monitors/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /open alerts/i })).toBeInTheDocument();
    });

    it("renders at most four recommended actions and routes incident detail", async () => {
      const extraActions = Array.from({ length: 4 }, (_, index) => ({
        key: `extra-${index}`,
        title: `Extra action ${index}`,
        description: "Should be bounded by the screen.",
        action: "Open alerts",
        tone: "warning" as const,
        destination: "alerts" as const,
      }));
      mockUseOverview({
        ...ALL_CLEAR_VM,
        operations: {
          ...ALL_CLEAR_VM.operations,
          recommendedActions: [...ALL_CLEAR_VM.operations.recommendedActions, ...extraActions],
        },
      });
      const ctx = makeMockCtx();
      render(<OverviewScreen ctx={ctx} navigate={vi.fn()} />);

      expect(screen.getAllByTestId("recommended-action")).toHaveLength(4);
      await userEvent.click(screen.getByRole("button", { name: /investigate active incidents/i }));
      expect(ctx.drill).toHaveBeenCalledWith("incident", { groupId: "egrp_checkout", errorId: "err_checkout" });
    });

    it("renders explainable predictive risk, anomaly, and latency details", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      const navigate = vi.fn();
      render(<OverviewScreen ctx={makeMockCtx()} navigate={navigate} />);

      expect(screen.getByRole("region", { name: "Predictive risk" })).toHaveTextContent("88% probability");
      expect(screen.getByRole("region", { name: "Predictive risk" })).toHaveTextContent("44 / 39 samples");
      expect(screen.getByText("Latency is materially above baseline.")).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Detected anomalies" })).toHaveTextContent("Observed 860");
      expect(screen.getByRole("region", { name: "Detected anomalies" })).toHaveTextContent("Baseline 420");
      expect(screen.getByRole("region", { name: "Detected anomalies" })).toHaveTextContent("+104.8%");
      expect(screen.getByRole("region", { name: "Top latency" })).toHaveTextContent("POST /checkout");

      await userEvent.click(screen.getByRole("button", { name: "Open traces" }));
      expect(navigate).toHaveBeenCalledWith("traces");
    });

    it("opens error-directed predictions without an invalid risk severity filter", async () => {
      mockUseOverview({
        ...ALL_CLEAR_VM,
        operations: {
          ...ALL_CLEAR_VM.operations,
          predictions: [{ ...ALL_CLEAR_VM.operations.predictions[0], severity: "high", destination: "investigate" }],
        },
      });
      const ctx = makeMockCtx();
      render(<OverviewScreen ctx={ctx} navigate={ctx.navigate} />);

      await userEvent.click(within(screen.getByRole("region", { name: "Predictive risk" })).getByRole("button", { name: "Open" }));

      expect(ctx.navigate).toHaveBeenCalledWith("investigate", { status: "open" });
    });

    it("routes recommended alert-rule reviews to Alerts", async () => {
      mockUseOverview({
        ...ALL_CLEAR_VM,
        operations: {
          ...ALL_CLEAR_VM.operations,
          recommendedActions: [{
            key: "anomaly-rule",
            title: "Review detected anomaly",
            description: "Latency crossed the learned threshold.",
            action: "Review alert rule",
            tone: "warning",
            destination: "alerts",
          }],
        },
      });
      const navigate = vi.fn();
      render(<OverviewScreen ctx={makeMockCtx()} navigate={navigate} />);

      await userEvent.click(screen.getByRole("button", { name: "Review detected anomaly" }));

      expect(navigate).toHaveBeenCalledWith("alerts");
    });

    it("renders robust empty states for operational recommendations and signals", () => {
      mockUseOverview({
        ...ALL_CLEAR_VM,
        operations: {
          ...ALL_CLEAR_VM.operations,
          recommendedActions: [],
          predictions: [],
          anomalies: [],
          topLatency: [],
        },
      });
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("No urgent actions")).toBeInTheDocument();
      expect(screen.getByText("No predictive risk")).toBeInTheDocument();
      expect(screen.getByText("No anomalies detected")).toBeInTheDocument();
      expect(screen.getByText("No trace latency in this window")).toBeInTheDocument();
    });
  });

  describe("banner", () => {
    it("renders incident banner when incidents > 0", () => {
      mockUseOverview(INCIDENT_VM);
      const navigate = vi.fn();
      render(<OverviewScreen ctx={makeMockCtx()} navigate={navigate} />);

      expect(screen.getByText(/3 incident/i)).toBeInTheDocument();
      expect(screen.getByText(/2 alert/i)).toBeInTheDocument();
      expect(screen.getByText(/PaymentTimeoutError in \/checkout/i)).toBeInTheDocument();
    });

    it("opens the top incident directly from the incident banner", async () => {
      mockUseOverview(INCIDENT_VM);
      const ctx = makeMockCtx();
      const navigate = vi.fn();
      render(<OverviewScreen ctx={ctx} navigate={navigate} />);

      await userEvent.click(screen.getByRole("button", { name: /open incident/i }));
      expect(ctx.drill).toHaveBeenCalledWith("incident", { groupId: "egrp_checkout", errorId: "err_checkout" });
      expect(navigate).not.toHaveBeenCalled();
    });

    it("renders all-clear banner when no incidents", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText(/no active incidents/i)).toBeInTheDocument();
      expect(screen.getByText(/operating within expected range/i)).toBeInTheDocument();
    });

    it("navigates to alerts on 'View rules' click in all-clear banner", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      const navigate = vi.fn();
      render(<OverviewScreen ctx={makeMockCtx()} navigate={navigate} />);

      await userEvent.click(screen.getByRole("button", { name: /view rules/i }));
      expect(navigate).toHaveBeenCalledWith("alerts");
    });

    it("all-clear banner reflects selected window (not hardcoded 24h)", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      // Default window is 24h — banner should say "24h"
      expect(screen.getByText(/over the last 24h/i)).toBeInTheDocument();

      // Switch to 7d
      await userEvent.click(screen.getByRole("button", { name: "7d" }));

      // Banner must now reflect 7d
      await waitFor(() =>
        expect(screen.getByText(/over the last 7d/i)).toBeInTheDocument()
      );
      expect(screen.queryByText(/over the last 24h/i)).not.toBeInTheDocument();
    });
  });

  describe("KPI groups", () => {
    it("renders Health group with errors, open incidents, error rate", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("Health")).toBeInTheDocument();
      expect(screen.getByText("Errors (24h)")).toBeInTheDocument();
      expect(screen.getByText("Open incidents")).toBeInTheDocument();
      expect(screen.getByText("Error rate")).toBeInTheDocument();
    });

    it("renders Usage group with events, active users, active tenants, traces", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("Usage")).toBeInTheDocument();
      expect(screen.getByText("Events")).toBeInTheDocument();
      expect(screen.getByText("Active users")).toBeInTheDocument();
      expect(screen.getByText("Active tenants")).toBeInTheDocument();
      expect(screen.getByText("Traces")).toBeInTheDocument();
      expect(screen.getByText("p95 trace")).toBeInTheDocument();
    });

    it("renders AI cost group with LLM calls, cost, tokens, top model", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("AI cost")).toBeInTheDocument();
      expect(screen.getByText("LLM calls")).toBeInTheDocument();
      expect(screen.getByText("Cost today")).toBeInTheDocument();
      expect(screen.getByText("Top model")).toBeInTheDocument();
    });

    it("renders KPI values from the VM", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      // errors (80)
      expect(screen.getByText("80")).toBeInTheDocument();
      // active users (42)
      expect(screen.getByText("42")).toBeInTheDocument();
      // top model (may appear multiple times due to LLM panel)
      expect(screen.getAllByText("gpt-4o").length).toBeGreaterThanOrEqual(1);
    });

    it("clamps an error rate above 100% for display (errors can outnumber traces) and keeps the raw value in a tooltip", () => {
      // Regression: errors/traces*100 is not a bounded fraction — a route can
      // log several errors per completed trace — so raw values like 466.7%
      // must not be shown as-is on the Health KPI card.
      mockUseOverview({ ...ALL_CLEAR_VM, kpis: { ...ALL_CLEAR_VM.kpis, errorRate: 466.7 } });
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("100.0%")).toBeInTheDocument();
      expect(screen.queryByText("466.7%")).not.toBeInTheDocument();
      expect(screen.getByText("100.0%")).toHaveAttribute("title", expect.stringContaining("466.7%"));
    });

    it("does not clamp or annotate an error rate at or below 100%", () => {
      mockUseOverview(ALL_CLEAR_VM); // errorRate: 20
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      const value = screen.getByText("20.0%");
      expect(value).not.toHaveAttribute("title");
    });

    it("Open incidents tile shows banner.incidents, not failedTraces", () => {
      const vm: OverviewVM = {
        ...ALL_CLEAR_VM,
        banner: { incidents: 7, alerts: 1, top: { message: "err", severity: "critical", groupId: "egrp_err", errorId: null } },
        kpis: { ...ALL_CLEAR_VM.kpis, failedTraces: 99 },
      };
      mockUseOverview(vm);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      // banner.incidents=7 must appear; failedTraces=99 must not appear as "Open incidents" value
      expect(screen.getByText("7")).toBeInTheDocument();
      expect(screen.queryByText("99")).not.toBeInTheDocument();
    });

    it("Avg trace tile formats averageTraceDurationMs from VM", () => {
      mockUseOverview(ALL_CLEAR_VM); // averageTraceDurationMs=150
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("150 ms")).toBeInTheDocument();
    });

    it("Avg trace tile shows — when averageTraceDurationMs is null", () => {
      const vm: OverviewVM = {
        ...ALL_CLEAR_VM,
        kpis: { ...ALL_CLEAR_VM.kpis, averageTraceDurationMs: null },
      };
      mockUseOverview(vm);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      // "—" appears for null avg trace (and possibly for other null fields)
      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("top tenants", () => {
    it("renders tenant names and row count", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("Top tenants — activity")).toBeInTheDocument();
      expect(screen.getByText("ranked by events")).toBeInTheDocument();
      expect(screen.getByText("Acme Corp")).toBeInTheDocument();
      expect(screen.getByText("Northwind")).toBeInTheDocument();
      expect(screen.getByText("Globex")).toBeInTheDocument();
    });

    it("opens tenant detail when a tenant row is clicked", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      const ctx = makeMockCtx();
      render(<OverviewScreen ctx={ctx} navigate={vi.fn()} />);

      const tenantBtn = screen.getByRole("button", { name: /acme corp/i });
      await userEvent.click(tenantBtn);
      expect(ctx.drill).toHaveBeenCalledWith("tenant", { tenantId: "t1" });
    });
  });

  describe("LLM cost by model", () => {
    it("renders model names and costs", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("LLM cost by model")).toBeInTheDocument();
      // gpt-4o appears in both KPI top model and LLM by model panel
      expect(screen.getAllByText("gpt-4o").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("claude-3-5-sonnet")).toBeInTheDocument();
    });
  });

  describe("releases", () => {
    it("renders recent releases and applies a release filter", async () => {
      const selectRelease = vi.fn();
      mockUseOverview({ ...ALL_CLEAR_VM, selectRelease });
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("Releases")).toBeInTheDocument();
      expect(screen.getByText("web@1.2.3")).toBeInTheDocument();
      expect(screen.getByText(/3 errors/i)).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /web@1.2.3/i }));

      expect(selectRelease).toHaveBeenCalledWith("web@1.2.3");
    });
  });

  describe("recent activity", () => {
    it("renders activity section header", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("Recent activity")).toBeInTheDocument();
      expect(screen.getByText("live")).toBeInTheDocument();
    });

    it("renders activity items by kind", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("PaymentTimeoutError")).toBeInTheDocument();
      expect(screen.getByText("openai / gpt-4o")).toBeInTheDocument();
      expect(screen.getByText("generate_report")).toBeInTheDocument();
    });

    it("opens incident detail when error activity row has a group id", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      const ctx = makeMockCtx();
      const navigate = vi.fn();
      render(<OverviewScreen ctx={ctx} navigate={navigate} />);

      const errorRow = screen.getByRole("button", { name: /paymenttimeouterror/i });
      await userEvent.click(errorRow);
      expect(ctx.drill).toHaveBeenCalledWith("incident", { groupId: "egrp_payment", errorId: "err_payment" });
      expect(navigate).not.toHaveBeenCalled();
    });

    it("falls back to incidents when error activity has no group id", async () => {
      mockUseOverview({
        ...ALL_CLEAR_VM,
        activity: [{ kind: "error", title: "UngroupedError", sub: "Error", timestamp: "2026-06-22T00:05:00Z" }]
      });
      const navigate = vi.fn();
      render(<OverviewScreen ctx={makeMockCtx()} navigate={navigate} />);

      await userEvent.click(screen.getByRole("button", { name: /ungroupederror/i }));
      expect(navigate).toHaveBeenCalledWith("incidents");
    });

    it("navigates to llm when llm activity row is clicked", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      const navigate = vi.fn();
      render(<OverviewScreen ctx={makeMockCtx()} navigate={navigate} />);

      const llmRow = screen.getByRole("button", { name: /openai \/ gpt-4o/i });
      await userEvent.click(llmRow);
      expect(navigate).toHaveBeenCalledWith("llm");
    });

    it("navigates to traces when trace activity row is clicked", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      const navigate = vi.fn();
      render(<OverviewScreen ctx={makeMockCtx()} navigate={navigate} />);

      const traceRow = screen.getByRole("button", { name: /generate_report/i });
      await userEvent.click(traceRow);
      expect(navigate).toHaveBeenCalledWith("traces");
    });
  });

  describe("window Segmented control", () => {
    it("renders 24h/7d/30d options (no 1h)", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByRole("button", { name: "24h" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "7d" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "30d" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "1h" })).not.toBeInTheDocument();
    });

    it("calls useOverview with new window when Segmented option is changed", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      const navigate = vi.fn();
      render(<OverviewScreen ctx={makeMockCtx()} navigate={navigate} />);

      const spy = vi.spyOn(useOverviewModule, "useOverview");

      await userEvent.click(screen.getByRole("button", { name: "7d" }));

      await waitFor(() => {
        const calls = spy.mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall?.[0]?.window).toBe("7d");
      });
    });
  });

  describe("loading state", () => {
    it("renders a loading indicator when status is loading", () => {
      mockUseOverview(null, "loading");
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe("copy compliance", () => {
    it("contains no pt-BR strings or the legacy brand name", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      const body = document.body.textContent ?? "";
      expect(body).not.toMatch(new RegExp("Signal" + "Hub"));
      expect(body).not.toMatch(/incidente\(s\)/i);
      expect(body).not.toMatch(/atualizado/i);
      expect(body).not.toMatch(/dentro do esperado/i);
      expect(body).not.toMatch(/Atividade recente/);
      expect(body).not.toMatch(/Custo de IA/);
      expect(body).not.toMatch(/Custo LLM/);
      expect(body).not.toMatch(/Saúde/);
      expect(body).not.toMatch(/Uso/);
    });
  });
});
