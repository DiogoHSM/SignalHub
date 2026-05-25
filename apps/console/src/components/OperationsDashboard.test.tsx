import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { OperationsResponse } from "../api/types";
import { OperationsDashboard } from "./OperationsDashboard";

function operationsResponse(overrides: Partial<OperationsResponse> = {}): OperationsResponse {
  return {
    window: "24h",
    generatedAt: "2026-05-25T12:00:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-05-24T12:00:00.000Z", to: "2026-05-25T12:00:00.000Z" },
    status: "degraded",
    summary: {
      monitors: {
        total: 2,
        http: { total: 1, up: 1, degraded: 0, down: 0, paused: 0, unknown: 0 },
        heartbeat: { total: 1, up: 0, degraded: 1, down: 0, paused: 0, unknown: 0 }
      },
      alerts: {
        rules: { total: 2, enabled: 2 },
        events: { total: 1, critical: 0, warning: 1, deliveryFailed: 1, deliveryPending: 0 }
      },
      telemetry: {
        events: 18,
        errors: 2,
        traces: 10,
        failedTraces: 1,
        errorRatePercent: 20,
        p95TraceDurationMs: 640,
        lastEventAt: "2026-05-25T11:58:00.000Z",
        lastErrorAt: "2026-05-25T11:50:00.000Z",
        lastTraceAt: "2026-05-25T11:57:00.000Z"
      },
      incidents: { open: 1, investigating: 1, urgent: 0, high: 1, regressed: 0 }
    },
    recent: {
      monitors: [
        {
          id: "mon_1",
          kind: "http",
          name: "API uptime",
          status: "up",
          lastCheckedAt: "2026-05-25T11:59:00.000Z",
          lastHeartbeatAt: null,
          lastCheckLatencyMs: 82,
          lastCheckErrorMessage: null
        }
      ],
      alerts: [
        {
          id: "alrt_1",
          severity: "warning",
          triggeredAt: "2026-05-25T11:50:00.000Z",
          message: "Checkout p95 latency is high",
          latestDeliveryStatus: "failed"
        }
      ],
      incidents: [
        {
          id: "egrp_1",
          message: "Checkout failed",
          severity: "critical",
          status: "open",
          priority: "high",
          lastSeenAt: "2026-05-25T11:50:00.000Z",
          latestErrorId: "err_1"
        }
      ]
    },
    topLatency: [{ name: "checkout", p95TraceDurationMs: 640, traces: 10, failedTraces: 1 }],
    setupGaps: [{ key: "heartbeat_monitor", label: "No heartbeat monitor", severity: "warning", action: "monitors" }],
    ...overrides
  };
}

function client(getOperations?: ApiClient["getOperations"]): ApiClient {
  return { getOperations } as ApiClient;
}

const callbacks = () => ({
  onOpenAlerts: vi.fn(),
  onOpenErrors: vi.fn(),
  onOpenIncident: vi.fn(),
  onOpenMonitors: vi.fn(),
  onOpenTraces: vi.fn()
});

afterEach(() => {
  cleanup();
});

describe("OperationsDashboard", () => {
  it("shows an empty scope message without loading operations", () => {
    const getOperations = vi.fn();

    render(<OperationsDashboard client={client(getOperations)} {...callbacks()} />);

    expect(screen.getByText("Select a project and environment in Setup to view operations.")).toBeInTheDocument();
    expect(getOperations).not.toHaveBeenCalled();
  });

  it("loads operation cards and recent activity", async () => {
    const getOperations = vi.fn().mockResolvedValue({ data: operationsResponse() });

    render(<OperationsDashboard client={client(getOperations)} environmentId="env_1" projectId="prj_1" {...callbacks()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading operations");
    await waitFor(() => expect(screen.getByText("Project status")).toBeInTheDocument());
    expect(screen.getByText("Checkout p95 latency is high")).toBeInTheDocument();
    expect(screen.getByText("checkout")).toBeInTheDocument();
    expect(getOperations).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", window: "24h" });
  });

  it("switches windows and retries unavailable requests", async () => {
    const getOperations = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: operationsResponse({ window: "24h" }) })
      .mockResolvedValueOnce({ data: operationsResponse({ window: "7d" }) });

    render(<OperationsDashboard client={client(getOperations)} environmentId="env_1" projectId="prj_1" {...callbacks()} />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Operations unavailable"));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Project status")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "7d" }));

    await waitFor(() => expect(getOperations).toHaveBeenLastCalledWith({ projectId: "prj_1", environmentId: "env_1", window: "7d" }));
  });

  it("calls drilldown handlers", async () => {
    const getOperations = vi.fn().mockResolvedValue({ data: operationsResponse() });
    const handlers = callbacks();

    render(<OperationsDashboard client={client(getOperations)} environmentId="env_1" projectId="prj_1" {...handlers} />);

    await waitFor(() => expect(screen.getByText("Project status")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Open monitors/i }));
    await userEvent.click(screen.getByRole("button", { name: /Open alerts/i }));
    await userEvent.click(screen.getByRole("button", { name: /Open issues/i }));
    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));
    await userEvent.click(screen.getByRole("button", { name: "Checkout failed" }));

    expect(handlers.onOpenMonitors).toHaveBeenCalled();
    expect(handlers.onOpenAlerts).toHaveBeenCalled();
    expect(handlers.onOpenErrors).toHaveBeenCalledWith({ status: "open" });
    expect(handlers.onOpenTraces).toHaveBeenCalledWith({ traceName: "checkout" });
    expect(handlers.onOpenIncident).toHaveBeenCalledWith("egrp_1", { errorId: "err_1" });
  });
});

