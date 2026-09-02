import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, FleetProject, FleetResponse } from "../api/client";
import type { User } from "../api/types";
import { MobileStatusView } from "./MobileStatusView";

const ADMIN_USER: User = { id: "usr_1", email: "admin@example.com", isAdmin: true };
const PROJECT_1 = { id: "prj_1", name: "Pinima", createdAt: "", updatedAt: "", archivedAt: null };

const mockFleetProject = (overrides: Partial<FleetProject> = {}): FleetProject => ({
  id: "prj_1",
  name: "Pinima",
  status: "ok",
  incidents: 0,
  alerts: 0,
  errorRatePercent: 0.5,
  errorRateDelta: null,
  errorTrend: [],
  events: 100,
  activeUsers: 5,
  activeTenants: 1,
  llmCostUsd: "0.00",
  llmCostDeltaUsd: null,
  p95TraceDurationMs: null,
  p95DeltaMs: null,
  infra: { api: "ok", db: "ok", redis: "ok", queue: "ok" },
  topIncident: null,
  ...overrides
});

function makeFleetResponse(projects: FleetProject[]): FleetResponse {
  const critical = projects.filter((p) => p.status === "critical").length;
  const warning = projects.filter((p) => p.status === "warning").length;
  const ok = projects.length - critical - warning;
  return {
    data: {
      window: "24h",
      generatedAt: "2026-08-25T00:00:00Z",
      projects,
      rollup: {
        counts: { ok, warning, critical },
        incidents: projects.reduce((sum, p) => sum + p.incidents, 0),
        alerts: 0,
        llmCostUsd: "0.00",
        overall: critical > 0 ? "critical" : warning > 0 ? "warning" : "ok",
        total: projects.length
      }
    }
  };
}

function makeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn().mockResolvedValue({ projects: [PROJECT_1] }),
    listEnvironments: vi.fn().mockResolvedValue({ environments: [] }),
    fetchFleet: vi.fn().mockResolvedValue(makeFleetResponse([mockFleetProject()])),
    fetchFleetProjectEnvironments: vi.fn().mockResolvedValue({
      data: { projectId: "prj_1", envs: [{ name: "production", status: "ok", incidents: 0, errorRatePercent: 0, events: 0, note: null }] }
    }),
    ...overrides
  } as unknown as ApiClient;
}

afterEach(() => {
  cleanup();
});

describe("MobileStatusView", () => {
  it("settles the project chevron immediately at its open or closed state for reduced motion", () => {
    const root = process.cwd().endsWith("apps/console") ? process.cwd() : join(process.cwd(), "apps", "console");
    const css = readFileSync(join(root, "src", "v2", "mobile-status.css"), "utf8");
    const reduced = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}\s*$/)?.[1] ?? "";
    expect(reduced).toMatch(/\.ms-card__chevron\s*\{[^}]*transition-duration:\s*0\.01ms/s);
    expect(reduced).toMatch(/\.ms-card\[data-open="true"\]\s+\.ms-card__chevron\s*\{[^}]*transform:\s*rotate\(90deg\)/s);
  });

  it("renders the fleet rollup banner and project list", async () => {
    const client = makeClient();
    render(<MobileStatusView client={client} user={ADMIN_USER} onSignOut={vi.fn()} />);

    expect(await screen.findByText("Operational")).toBeInTheDocument();
    expect(screen.getByText("Pinima")).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
  });

  it("shows a critical banner and incident count when a project is down", async () => {
    const client = makeClient({
      fetchFleet: vi.fn().mockResolvedValue(
        makeFleetResponse([mockFleetProject({ status: "critical", incidents: 2 })])
      )
    });
    render(<MobileStatusView client={client} user={ADMIN_USER} onSignOut={vi.fn()} />);

    expect(await screen.findByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("1 critical")).toBeInTheDocument();
    expect(screen.getByText("2 open incidents")).toBeInTheDocument();
  });

  it("expands a project on tap to load and show its environments", async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<MobileStatusView client={client} user={ADMIN_USER} onSignOut={vi.fn()} />);

    const card = await screen.findByRole("button", { name: /Pinima/ });
    await user.click(card);

    await waitFor(() =>
      expect(client.fetchFleetProjectEnvironments).toHaveBeenCalledWith("prj_1", { window: "24h" })
    );
    expect(await screen.findByText("production")).toBeInTheDocument();
  });

  it("calls onSignOut when the sign-out button is pressed", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn().mockResolvedValue(undefined);
    const client = makeClient();
    render(<MobileStatusView client={client} user={ADMIN_USER} onSignOut={onSignOut} />);

    await screen.findByText("Operational");
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("uses the shared hit target for mobile refresh, sign-out, and project controls", async () => {
    const client = makeClient();
    render(<MobileStatusView client={client} user={ADMIN_USER} onSignOut={vi.fn()} />);

    await screen.findByText("Operational");
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveClass("sh-hit-target");
    expect(screen.getByRole("button", { name: /refresh/i })).toHaveClass("sh-hit-target");
    expect(screen.getByRole("button", { name: /Pinima/ })).toHaveClass("sh-hit-target");
  });
});
