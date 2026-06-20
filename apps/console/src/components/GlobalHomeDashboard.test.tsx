import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../api/types";
import { GlobalHomeDashboard } from "./GlobalHomeDashboard";

const projects: Project[] = [
  {
    id: "prj_microerp",
    name: "MicroERP",
    createdAt: "2026-06-20T12:00:00.000Z",
    updatedAt: "2026-06-20T12:00:00.000Z",
    archivedAt: null
  },
  {
    id: "prj_dissip",
    name: "dissip",
    createdAt: "2026-06-20T12:00:00.000Z",
    updatedAt: "2026-06-20T12:00:00.000Z",
    archivedAt: null
  }
];

afterEach(() => {
  cleanup();
});

describe("GlobalHomeDashboard", () => {
  it("renders the executive risk home with monitored projects", () => {
    render(<GlobalHomeDashboard isLoading={false} onOpenProject={vi.fn()} projects={projects} />);

    expect(screen.getByRole("heading", { name: "Executive risk dashboard" })).toBeInTheDocument();
    expect(screen.getByText("All monitored projects, ordered by operational attention needed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open MicroERP operations/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open dissip operations/i })).toBeInTheDocument();
  });

  it("opens project operations from a project row", async () => {
    const user = userEvent.setup();
    const onOpenProject = vi.fn();

    render(<GlobalHomeDashboard isLoading={false} onOpenProject={onOpenProject} projects={projects} />);

    await user.click(screen.getByRole("button", { name: /Open MicroERP operations/i }));

    expect(onOpenProject).toHaveBeenCalledWith("prj_microerp");
  });

  it("renders an actionable empty state when no projects exist", () => {
    render(<GlobalHomeDashboard isLoading={false} onOpenProject={vi.fn()} projects={[]} />);

    expect(screen.getByText("No monitored projects yet.")).toBeInTheDocument();
    expect(screen.getByText("Create a project in Configure or Onboarding to start collecting telemetry.")).toBeInTheDocument();
  });

  it("orders monitored projects by operational risk and explains the strongest signal", () => {
    render(
      <GlobalHomeDashboard
        isLoading={false}
        onOpenProject={vi.fn()}
        projectSignals={{
          prj_dissip: {
            status: "critical",
            openIncidents: 3,
            downMonitors: 1,
            criticalAlerts: 1,
            p95LatencyMs: 1820,
            errorRatePercent: 6.4,
            setupGaps: 0
          },
          prj_microerp: {
            status: "healthy",
            openIncidents: 0,
            downMonitors: 0,
            criticalAlerts: 0,
            p95LatencyMs: 120,
            errorRatePercent: 0.2,
            setupGaps: 0
          }
        }}
        projects={projects}
      />
    );

    const rows = screen.getAllByRole("button", { name: /Open .* operations/i });

    expect(rows[0]).toHaveAccessibleName(/Open dissip operations/i);
    expect(rows[0]).toHaveTextContent("Critical");
    expect(rows[0]).toHaveTextContent("3 incidents");
    expect(rows[0]).toHaveTextContent("1 monitor down");
    expect(rows[0]).toHaveTextContent("p95 1.82s");
    expect(screen.getAllByText("Critical").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("marks projects without operational signals as low-data instead of healthy", () => {
    render(<GlobalHomeDashboard isLoading={false} onOpenProject={vi.fn()} projects={projects} />);

    expect(screen.getAllByText("Needs setup").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No operational rollup yet").length).toBeGreaterThan(0);
  });
});
