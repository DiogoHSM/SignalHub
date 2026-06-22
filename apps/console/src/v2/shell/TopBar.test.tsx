import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Project, Environment } from "../../api/types";
import { TopBar } from "./TopBar";
import type { BreadcrumbItem } from "./TopBar";

const PROJECTS: Project[] = [
  { id: "p1", name: "Acme Prod", createdAt: "", updatedAt: "", archivedAt: null },
  { id: "p2", name: "Acme Staging", createdAt: "", updatedAt: "", archivedAt: null },
];

const ENVIRONMENTS: Environment[] = [
  { id: "e1", projectId: "p1", name: "production", createdAt: "", updatedAt: "", archivedAt: null },
  { id: "e2", projectId: "p1", name: "staging", createdAt: "", updatedAt: "", archivedAt: null },
];

const PROJECT = PROJECTS[0];
const ENV = ENVIRONMENTS[0];

const CRUMB: BreadcrumbItem[] = [
  { label: "Overview" },
  { label: "Incidents" },
];

describe("TopBar", () => {
  it("renders the active project name in the pill", () => {
    const { container } = render(
      <TopBar
        projects={PROJECTS}
        project={PROJECT}
        environments={ENVIRONMENTS}
        env={ENV}
        onSelectProject={() => {}}
        onSelectEnv={() => {}}
        crumb={CRUMB}
        railCollapsed={false}
        onToggleRail={() => {}}
        onRefresh={() => {}}
        onOpenSearch={() => {}}
      />
    );
    // Project name should be in the first .sw-pill
    const pills = container.querySelectorAll(".sw-pill");
    expect(pills[0].textContent).toContain("Acme Prod");
  });

  it("renders the active environment name in the pill", () => {
    const { container } = render(
      <TopBar
        projects={PROJECTS}
        project={PROJECT}
        environments={ENVIRONMENTS}
        env={ENV}
        onSelectProject={() => {}}
        onSelectEnv={() => {}}
        crumb={CRUMB}
        railCollapsed={false}
        onToggleRail={() => {}}
        onRefresh={() => {}}
        onOpenSearch={() => {}}
      />
    );
    // Env name should be in the second .sw-pill
    const pills = container.querySelectorAll(".sw-pill");
    expect(pills[1].textContent).toContain("production");
  });

  it("clicking the project pill opens the menu listing all projects", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <TopBar
        projects={PROJECTS}
        project={PROJECT}
        environments={ENVIRONMENTS}
        env={ENV}
        onSelectProject={() => {}}
        onSelectEnv={() => {}}
        crumb={CRUMB}
        railCollapsed={false}
        onToggleRail={() => {}}
        onRefresh={() => {}}
        onOpenSearch={() => {}}
      />
    );

    // Menu should not be visible initially
    expect(container.querySelector(".sw-menu")).not.toBeInTheDocument();

    // Click the project pill (first .sw-pill)
    const pills = container.querySelectorAll(".sw-pill");
    await user.click(pills[0]);

    // Menu should now be visible with both projects listed as .sw-opt
    const menu = container.querySelector(".sw-menu");
    expect(menu).toBeInTheDocument();
    const opts = container.querySelectorAll(".sw-opt");
    const optTexts = Array.from(opts).map(o => o.textContent);
    expect(optTexts.some(t => t?.includes("Acme Prod"))).toBe(true);
    expect(optTexts.some(t => t?.includes("Acme Staging"))).toBe(true);
  });

  it("selecting a project from the menu calls onSelectProject with its id", async () => {
    const onSelectProject = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <TopBar
        projects={PROJECTS}
        project={PROJECT}
        environments={ENVIRONMENTS}
        env={ENV}
        onSelectProject={onSelectProject}
        onSelectEnv={() => {}}
        crumb={CRUMB}
        railCollapsed={false}
        onToggleRail={() => {}}
        onRefresh={() => {}}
        onOpenSearch={() => {}}
      />
    );

    // Open the project menu
    const pills = container.querySelectorAll(".sw-pill");
    await user.click(pills[0]);

    // Click on the second project
    const opts = container.querySelectorAll(".sw-opt");
    const stagingOpt = Array.from(opts).find(o => o.textContent?.includes("Acme Staging"));
    await user.click(stagingOpt as HTMLElement);

    expect(onSelectProject).toHaveBeenCalledWith("p2");
  });

  it("breadcrumb renders crumb labels", () => {
    const { container } = render(
      <TopBar
        projects={PROJECTS}
        project={PROJECT}
        environments={ENVIRONMENTS}
        env={ENV}
        onSelectProject={() => {}}
        onSelectEnv={() => {}}
        crumb={CRUMB}
        railCollapsed={false}
        onToggleRail={() => {}}
        onRefresh={() => {}}
        onOpenSearch={() => {}}
      />
    );

    const bc = container.querySelector(".bc");
    expect(bc).toBeInTheDocument();
    expect(bc?.textContent).toContain("Overview");
    expect(bc?.textContent).toContain("Incidents");
  });

  it("clicking the search affordance calls onOpenSearch", async () => {
    const onOpenSearch = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <TopBar
        projects={PROJECTS}
        project={PROJECT}
        environments={ENVIRONMENTS}
        env={ENV}
        onSelectProject={() => {}}
        onSelectEnv={() => {}}
        crumb={CRUMB}
        railCollapsed={false}
        onToggleRail={() => {}}
        onRefresh={() => {}}
        onOpenSearch={onOpenSearch}
      />
    );

    const searchEl = container.querySelector(".tb-search");
    await user.click(searchEl as HTMLElement);
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("renders .tb root element and .tb-actions", () => {
    const { container } = render(
      <TopBar
        projects={PROJECTS}
        project={PROJECT}
        environments={ENVIRONMENTS}
        env={ENV}
        onSelectProject={() => {}}
        onSelectEnv={() => {}}
        crumb={CRUMB}
        railCollapsed={false}
        onToggleRail={() => {}}
        onRefresh={() => {}}
        onOpenSearch={() => {}}
      />
    );

    expect(container.querySelector(".tb")).toBeInTheDocument();
    expect(container.querySelector(".tb-actions")).toBeInTheDocument();
  });
});
