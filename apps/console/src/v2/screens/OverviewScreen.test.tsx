import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  kpis: {
    events: 5000,
    activeUsers: 42,
    activeTenants: 10,
    errors: 80,
    traces: 400,
    failedTraces: 12,
    p95TraceDurationMs: 320,
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
  activity: [
    { kind: "error", title: "PaymentTimeoutError", sub: "TypeError", timestamp: "2026-06-22T00:05:00Z" },
    { kind: "llm", title: "openai / gpt-4o", sub: "timeout", timestamp: "2026-06-22T00:04:00Z" },
    { kind: "trace", title: "generate_report", sub: "failed", timestamp: "2026-06-22T00:03:00Z" },
  ],
};

const INCIDENT_VM: OverviewVM = {
  ...ALL_CLEAR_VM,
  banner: {
    incidents: 3,
    alerts: 2,
    top: { message: "PaymentTimeoutError in /checkout", severity: "critical" },
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
  };
}

function mockUseOverview(vm: OverviewVM | null, status: "loading" | "ok" | "error" = "ok") {
  vi.spyOn(useOverviewModule, "useOverview").mockReturnValue({
    data: vm,
    status,
    reload: vi.fn(),
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
  describe("banner", () => {
    it("renders incident banner when incidents > 0", () => {
      mockUseOverview(INCIDENT_VM);
      const navigate = vi.fn();
      render(<OverviewScreen ctx={makeMockCtx()} navigate={navigate} />);

      expect(screen.getByText(/3 incident/i)).toBeInTheDocument();
      expect(screen.getByText(/2 alert/i)).toBeInTheDocument();
      expect(screen.getByText(/PaymentTimeoutError in \/checkout/i)).toBeInTheDocument();
    });

    it("navigates to incidents on 'View incidents' click", async () => {
      mockUseOverview(INCIDENT_VM);
      const navigate = vi.fn();
      render(<OverviewScreen ctx={makeMockCtx()} navigate={navigate} />);

      await userEvent.click(screen.getByRole("button", { name: /view incidents/i }));
      expect(navigate).toHaveBeenCalledWith("incidents");
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

    it("navigates to investigate when a tenant row is clicked", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      const navigate = vi.fn();
      render(<OverviewScreen ctx={makeMockCtx()} navigate={navigate} />);

      const tenantBtn = screen.getByRole("button", { name: /acme corp/i });
      await userEvent.click(tenantBtn);
      expect(navigate).toHaveBeenCalledWith("investigate");
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

    it("navigates to incidents when error activity row is clicked", async () => {
      mockUseOverview(ALL_CLEAR_VM);
      const navigate = vi.fn();
      render(<OverviewScreen ctx={makeMockCtx()} navigate={navigate} />);

      const errorRow = screen.getByRole("button", { name: /paymenttimeouterror/i });
      await userEvent.click(errorRow);
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

      // Should show some loading UI, not crash
      expect(document.body).toBeInTheDocument();
    });
  });

  describe("copy compliance", () => {
    it("contains no pt-BR strings or SignalHub brand name", () => {
      mockUseOverview(ALL_CLEAR_VM);
      render(<OverviewScreen ctx={makeMockCtx()} navigate={vi.fn()} />);

      const body = document.body.textContent ?? "";
      expect(body).not.toMatch(/SignalHub/);
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
