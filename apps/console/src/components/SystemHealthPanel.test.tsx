import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { SystemHealthResponse } from "../api/types";
import { SystemHealthPanel } from "./SystemHealthPanel";

function client(getSystemHealth: ApiClient["getSystemHealth"]): ApiClient {
  return { getSystemHealth } as ApiClient;
}

function healthyResponse(overrides: Partial<SystemHealthResponse> = {}): SystemHealthResponse {
  return {
    generatedAt: "2026-05-06T12:00:00.000Z",
    status: "healthy",
    services: {
      api: { status: "healthy", uptimeSeconds: 120 },
      postgres: { status: "healthy", latencyMs: 4 },
      redis: { status: "healthy", latencyMs: 2 },
      worker: { status: "healthy", lastHeartbeatAt: "2026-05-06T11:59:55.000Z" }
    },
    queues: {
      telemetry: { waiting: 1, active: 2, completed: 30, failed: 0, delayed: 3 }
    },
    ingestion: {
      lastEventAt: "2026-05-06T11:58:00.000Z",
      lastErrorAt: null,
      lastTraceAt: "2026-05-06T11:57:00.000Z",
      lastSpanAt: "2026-05-06T11:57:10.000Z",
      lastLlmCallAt: null
    },
    retention: {
      enabled: true,
      intervalMinutes: 60,
      lastRun: {
        id: "ret_1",
        status: "success",
        startedAt: "2026-05-06T10:00:00.000Z",
        finishedAt: "2026-05-06T10:00:05.000Z",
        deleted: { events: 10, errors: 1, traces: 3, spans: 8, llmCalls: 2 },
        errorMessage: null
      },
      policy: { eventsDays: 90, errorsDays: 180, tracesDays: 90, spansDays: 90, llmCallsDays: 180 }
    },
    ...overrides
  };
}

afterEach(() => {
  cleanup();
});

describe("SystemHealthPanel", () => {
  it("renders a healthy system snapshot with services queues ingestion and retention", async () => {
    const api = client(vi.fn().mockResolvedValue({ data: healthyResponse() }));

    render(<SystemHealthPanel client={api} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading system health");
    expect(await screen.findByRole("heading", { name: "System" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "System health summary" })).getByText("healthy")).toBeInTheDocument();
    expect(screen.getByText("Postgres")).toBeInTheDocument();
    expect(screen.getByText("Redis")).toBeInTheDocument();
    expect(screen.getByText("Retention")).toBeInTheDocument();
    expect(screen.getByText(/^Generated /)).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getAllByText("No data")).toHaveLength(2);
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("events 90d")).toBeInTheDocument();
    expect(screen.getByText("success")).toBeInTheDocument();
  });

  it("retries after the system health request fails", async () => {
    const getSystemHealth = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ data: healthyResponse({ status: "degraded" }) });
    const api = client(getSystemHealth);

    render(<SystemHealthPanel client={api} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("System health unavailable");

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(getSystemHealth).toHaveBeenCalledTimes(2));
    const header = await screen.findByRole("group", { name: "System health summary" });
    expect(within(header).getByText("degraded")).toBeInTheDocument();
  });

  it("formats malformed timestamps as no data", async () => {
    const api = client(
      vi.fn().mockResolvedValue({
        data: healthyResponse({
          generatedAt: "not-a-date",
          services: {
            api: { status: "healthy", uptimeSeconds: 120 },
            postgres: { status: "healthy", latencyMs: 4 },
            redis: { status: "healthy", latencyMs: 2 },
            worker: { status: "healthy", lastHeartbeatAt: "not-a-date" }
          },
          ingestion: {
            lastEventAt: "not-a-date",
            lastErrorAt: null,
            lastTraceAt: "2026-05-06T11:57:00.000Z",
            lastSpanAt: "2026-05-06T11:57:10.000Z",
            lastLlmCallAt: null
          }
        })
      })
    );

    render(<SystemHealthPanel client={api} />);

    expect(await screen.findByRole("heading", { name: "System" })).toBeInTheDocument();
    expect(screen.queryByText("Invalid Date")).not.toBeInTheDocument();
    expect(screen.getByText("Generated No data")).toBeInTheDocument();
    expect(screen.getAllByText("No data").length).toBeGreaterThanOrEqual(4);
  });
});
