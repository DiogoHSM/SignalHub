import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => cleanup());

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

  it("selecting an environment from the menu calls onSelectEnv with its id", async () => {
    const onSelectEnv = vi.fn();
    const user = userEvent.setup();
    const environments: Environment[] = [
      { id: "e1", projectId: "p1", name: "production", createdAt: "", updatedAt: "", archivedAt: null },
      { id: "e2", projectId: "p1", name: "production", createdAt: "", updatedAt: "", archivedAt: null },
    ];
    const { container } = render(
      <TopBar
        projects={PROJECTS}
        project={PROJECT}
        environments={environments}
        env={environments[0]}
        onSelectProject={() => {}}
        onSelectEnv={onSelectEnv}
        crumb={CRUMB}
        railCollapsed={false}
        onToggleRail={() => {}}
        onRefresh={() => {}}
        onOpenSearch={() => {}}
      />
    );

    const pills = container.querySelectorAll(".sw-pill");
    await user.click(pills[1]);

    const opts = container.querySelectorAll(".sw-opt");
    await user.click(opts[1] as HTMLElement);

    expect(onSelectEnv).toHaveBeenCalledWith("e2");
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

  it("opens search from the keyboard through a native button", async () => {
    const onOpenSearch = vi.fn();
    const user = userEvent.setup();
    render(
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

    const search = screen.getByRole("button", { name: /search events/i });
    expect(search).toHaveAttribute("type", "button");
    search.focus();
    expect(search).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("uses the shared hit target for every visible top-bar action and omits notifications", () => {
    const { container } = render(
      <TopBar
        projects={PROJECTS}
        project={PROJECT}
        environments={ENVIRONMENTS}
        env={ENV}
        onSelectProject={() => {}}
        onSelectEnv={() => {}}
        crumb={[{ label: "Overview", onClick: () => {} }, { label: "Incidents" }]}
        railCollapsed={false}
        onToggleRail={() => {}}
        onRefresh={() => {}}
        onOpenSearch={() => {}}
      />
    );

    expect(screen.queryByTitle("Notifications")).not.toBeInTheDocument();
    const actions = Array.from(container.querySelectorAll("button"));
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((action) => action.classList.contains("sh-hit-target"))).toBe(true);
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

  it("opens an accessible account menu and signs out", async () => {
    const onSignOut = vi.fn().mockResolvedValue(undefined);
    render(
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
        userEmail="jane.doe@example.com"
        onSignOut={onSignOut}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    const menu = screen.getByRole("menu", { name: "Account" });
    expect(screen.getByText("jane.doe@example.com")).toBeInTheDocument();
    const signOut = within(menu).getByRole("menuitem", { name: "Sign out" });
    expect(signOut).toHaveFocus();
    expect(Array.from(menu.children).every((child) => child.getAttribute("role") === "menuitem")).toBe(true);
    await userEvent.click(signOut);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("supports account-menu arrow navigation and returns focus on Escape", async () => {
    render(
      <TopBar
        projects={PROJECTS} project={PROJECT} environments={ENVIRONMENTS} env={ENV}
        onSelectProject={() => {}} onSelectEnv={() => {}} crumb={CRUMB}
        railCollapsed={false} onToggleRail={() => {}} onRefresh={() => {}} onOpenSearch={() => {}}
        userEmail="jane.doe@example.com" onSignOut={vi.fn().mockResolvedValue(undefined)}
      />
    );
    const trigger = screen.getByRole("button", { name: "Open account menu" });
    await userEvent.click(trigger);
    const item = screen.getByRole("menuitem", { name: "Sign out" });

    await userEvent.keyboard("{ArrowDown}{ArrowUp}");
    expect(item).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Account" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps the account menu open and surfaces a retryable logout error", async () => {
    const onSignOut = vi.fn().mockRejectedValue(new Error("offline"));
    render(
      <TopBar
        projects={PROJECTS} project={PROJECT} environments={ENVIRONMENTS} env={ENV}
        onSelectProject={() => {}} onSelectEnv={() => {}} crumb={CRUMB}
        railCollapsed={false} onToggleRail={() => {}} onRefresh={() => {}} onOpenSearch={() => {}}
        userEmail="jane.doe@example.com" onSignOut={onSignOut}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign out. Try again.");
    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeEnabled();
  });
});
