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
  describe("page header", () => {
    it("identifies the promoted screen as Operations", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByRole("heading", { name: "Operations" })).toBeInTheDocument();
    });

    it("renders 24h/7d/30d window options", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByRole("button", { name: "24h" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "7d" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "30d" })).toBeInTheDocument();
    });

    it("calls useOverview with new window when Segmented option is changed", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      const spy = vi.spyOn(useOverviewModule, "useOverview");

      await userEvent.click(screen.getByRole("button", { name: "7d" }));

      await waitFor(() => {
        const calls = spy.mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall?.[0]?.window).toBe("7d");
      });
    });
  });

  describe("attention zone", () => {
    it("renders incident attention card when incidents > 0", () => {
      mockUseOverview(INCIDENT_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByRole("region", { name: "Top active incident" })).toBeInTheDocument();
      expect(
        within(screen.getByRole("region", { name: "Top active incident" })).getByText(/3 active incident/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/2 alert/i)).toBeInTheDocument();
      expect(screen.getByText(/PaymentTimeoutError in \/checkout/i)).toBeInTheDocument();
    });

    it("opens the top incident directly from the incident attention card", async () => {
      mockUseOverview(INCIDENT_VM);
      const ctx = makeMockCtx();
      render(<OverviewScreen ctx={ctx} navigate={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /open incident/i }));
      expect(ctx.drill).toHaveBeenCalledWith("incident", { groupId: "egrp_checkout", errorId: "err_checkout" });
    });

    it("renders all-clear banner when no incidents", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByRole("region", { name: "No active incidents" })).toBeInTheDocument();
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

    it("all-clear banner reflects selected window", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText(/over the last 24h/i)).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "7d" }));

      await waitFor(() => expect(screen.getByText(/over the last 7d/i)).toBeInTheDocument());
      expect(screen.queryByText(/over the last 24h/i)).not.toBeInTheDocument();
    });

    it("renders Up next recommended actions and routes incident detail", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      const ctx = makeMockCtx();
      render(<OverviewScreen ctx={ctx} navigate={vi.fn()} />);

      expect(screen.getByRole("region", { name: "Recommended next actions" })).toBeInTheDocument();
      expect(screen.getByText("Up next")).toBeInTheDocument();
      expect(
        within(screen.getByRole("region", { name: "Recommended next actions" })).getByText("01"),
      ).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /investigate active incidents/i }));
      expect(ctx.drill).toHaveBeenCalledWith("incident", { groupId: "egrp_checkout", errorId: "err_checkout" });
    });

    it("renders empty state when there are no recommended actions", () => {
      mockUseOverview({
        ...ALL_CLEAR_VM,
        operations: { ...ALL_CLEAR_VM.operations, recommendedActions: [] },
      });
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("No urgent actions")).toBeInTheDocument();
    });
  });

  describe("metrics strip", () => {
    it("renders all six KPI metrics", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("Metrics · last 24h")).toBeInTheDocument();
      expect(screen.getByText("Errors")).toBeInTheDocument();
      expect(screen.getByText("Error rate")).toBeInTheDocument();
      expect(screen.getByText("Events")).toBeInTheDocument();
      expect(screen.getByText("p95 trace")).toBeInTheDocument();
      expect(screen.getByText("LLM cost")).toBeInTheDocument();
      expect(screen.getByText("Active users")).toBeInTheDocument();
    });

    it("renders KPI values from the VM", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("80")).toBeInTheDocument();
      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.getByText("$ 3.50")).toBeInTheDocument();
    });

    it("clamps an error rate above 100% for display", () => {
      mockUseOverview({ ...ALL_CLEAR_VM, kpis: { ...ALL_CLEAR_VM.kpis, errorRate: 466.7 } });
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("100.0%")).toBeInTheDocument();
      expect(screen.queryByText("466.7%")).not.toBeInTheDocument();
    });

    it("toggles the metrics strip collapsed and expanded", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      const toggle = screen.getByRole("button", { name: /metrics · last 24h/i });
      expect(screen.getByText("Errors")).toBeInTheDocument();

      await userEvent.click(toggle);
      expect(screen.queryByText("Errors")).not.toBeInTheDocument();

      await userEvent.click(toggle);
      expect(screen.getByText("Errors")).toBeInTheDocument();
    });
  });

  describe("signals zone", () => {
    it("renders explainable predictive risk and anomaly details", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      const navigate = vi.fn();
      render(<OverviewScreen ctx={makeMockCtx()} navigate={navigate} />);

      expect(screen.getByRole("region", { name: "Predictive risk" })).toHaveTextContent("88% probability");
      expect(screen.getByRole("region", { name: "Predictive risk" })).toHaveTextContent("44 / 39 samples");
      expect(screen.getByText("Latency is materially above baseline.")).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Detected anomalies" })).toHaveTextContent("Observed 860");
      expect(screen.getByRole("region", { name: "Detected anomalies" })).toHaveTextContent("Baseline 420");
      expect(screen.getByRole("region", { name: "Detected anomalies" })).toHaveTextContent("+104.8%");

      await userEvent.click(within(screen.getByRole("region", { name: "Predictive risk" })).getByRole("button", { name: "Open" }));
      expect(navigate).toHaveBeenCalledWith("traces");
    });

    it("opens error-directed predictions to investigate", async () => {
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

    it("renders empty states for signals", () => {
      mockUseOverview({
        ...ALL_CLEAR_VM,
        operations: {
          ...ALL_CLEAR_VM.operations,
          predictions: [],
          anomalies: [],
        },
      });
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByText("No predictive risk")).toBeInTheDocument();
      expect(screen.getByText("No anomalies detected")).toBeInTheDocument();
    });
  });

  describe("explore tabs", () => {
    it("renders top tenants by default", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      expect(screen.getByRole("tab", { name: "Top tenants" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("Acme Corp")).toBeInTheDocument();
      expect(screen.getByText("Northwind")).toBeInTheDocument();
      expect(screen.getByText("Globex")).toBeInTheDocument();
    });

    it("opens tenant detail when a tenant row is clicked", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      const ctx = makeMockCtx();
      render(<OverviewScreen ctx={ctx} navigate={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: /acme corp/i }));
      expect(ctx.drill).toHaveBeenCalledWith("tenant", { tenantId: "t1" });
    });

    it("switches to AI cost tab", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      await userEvent.click(screen.getByRole("tab", { name: "AI cost" }));
      expect(screen.getByText("gpt-4o")).toBeInTheDocument();
      expect(screen.getByText("claude-3-5-sonnet")).toBeInTheDocument();
    });

    it("switches to releases tab and applies a release filter", async () => {
      const selectRelease = vi.fn();
      mockUseOverview({ ...ALL_CLEAR_VM, selectRelease });
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      await userEvent.click(screen.getByRole("tab", { name: "Releases" }));
      expect(screen.getByText("web@1.2.3")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /web@1.2.3/i }));
      expect(selectRelease).toHaveBeenCalledWith("web@1.2.3");
    });

    it("switches to activity tab and opens incident detail from error row", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      const ctx = makeMockCtx();
      render(<OverviewScreen ctx={ctx} navigate={vi.fn()} />);

      await userEvent.click(screen.getByRole("tab", { name: "Activity" }));
      const errorRow = screen.getByRole("button", { name: /paymenttimeouterror/i });
      await userEvent.click(errorRow);
      expect(ctx.drill).toHaveBeenCalledWith("incident", { groupId: "egrp_payment", errorId: "err_payment" });
    });

    it("switches to top latency tab", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      const navigate = vi.fn();
      render(<OverviewScreen ctx={makeMockCtx()} navigate={navigate} />);

      await userEvent.click(screen.getByRole("tab", { name: "Top latency" }));
      expect(screen.getByText("POST /checkout")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /post \/checkout/i }));
      expect(navigate).toHaveBeenCalledWith("traces");
    });

    it("keyboard navigation cycles through tabs", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      const tenantsTab = screen.getByRole("tab", { name: "Top tenants" });
      tenantsTab.focus();
      await userEvent.keyboard("{ArrowRight}");
      expect(screen.getByRole("tab", { name: "AI cost" })).toHaveFocus();
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
    });
  });
});
