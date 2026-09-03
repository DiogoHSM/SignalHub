import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NavRail } from "./NavRail";
import type { NavSection } from "../nav";
import { NAV, NAV_BOTTOM } from "../nav";

describe("NavRail", () => {
  it("renders one item per NAV + NAV_BOTTOM", () => {
    const { container } = render(
      <NavRail active="overview" onNavigate={() => {}} fleetCritical={0} />
    );

    const items = container.querySelectorAll(".nv-item");
    const expectedCount = NAV.length + NAV_BOTTOM.length;
    expect(items).toHaveLength(expectedCount);
    expect(Array.from(items).every((item) => item.classList.contains("sh-hit-target"))).toBe(true);
  });

  it("renders the logo with correct classes", () => {
    const { container } = render(
      <NavRail active="overview" onNavigate={() => {}} fleetCritical={0} />
    );

    const logo = container.querySelector(".nv-logo");
    expect(logo).toBeInTheDocument();

    const svg = logo?.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("marks the active item with is-active class", () => {
    const { container } = render(
      <NavRail active="incidents" onNavigate={() => {}} fleetCritical={0} />
    );

    const items = container.querySelectorAll(".nv-item");
    const incidentsItem = Array.from(items).find(item =>
      item.classList.contains("is-active")
    );

    expect(incidentsItem).toBeInTheDocument();
    expect((incidentsItem as HTMLElement | null)?.title).toBe("Incidents");
  });

  it("calls onNavigate when an item is clicked", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();

    const { container } = render(
      <NavRail active="overview" onNavigate={onNavigate} fleetCritical={0} />
    );

    const items = container.querySelectorAll(".nv-item");
    const investigateItem = Array.from(items).find(item =>
      item.textContent?.includes("Investigate")
    );

    await user.click(investigateItem as HTMLElement);

    expect(onNavigate).toHaveBeenCalledWith("investigate");
  });

  it("shows the incidents critical dot when fleetCritical > 0", () => {
    const { container } = render(
      <NavRail active="overview" onNavigate={() => {}} fleetCritical={5} />
    );

    const dot = container.querySelector(".nv-dot");
    expect(dot).toBeInTheDocument();
  });

  it("hides the incidents critical dot when fleetCritical is 0", () => {
    const { container } = render(
      <NavRail active="overview" onNavigate={() => {}} fleetCritical={0} />
    );

    const dot = container.querySelector(".nv-dot");
    expect(dot).not.toBeInTheDocument();
  });

  it("renders nav items with tooltips", () => {
    const { container } = render(
      <NavRail active="overview" onNavigate={() => {}} fleetCritical={0} />
    );

    const items = container.querySelectorAll(".nv-item");
    const labels = Array.from(items).map(item => (item as HTMLElement).title);

    expect(labels).toContain("Operations");
    expect(labels).not.toContain("Overview");
    expect(labels).toContain("Incidents");
    expect(labels).toContain("Settings");
  });

  it("renders the nv-spacer element to separate top and bottom sections", () => {
    const { container } = render(
      <NavRail active="overview" onNavigate={() => {}} fleetCritical={0} />
    );

    const spacer = container.querySelector(".nv-spacer");
    expect(spacer).toBeInTheDocument();
  });
});
