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
});
