import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavRail } from "./NavRail";

describe("NavRail", () => {
  afterEach(cleanup);
  it("groups readable destinations and identifies the current page", () => {
    render(<NavRail active="incidents" onNavigate={() => {}} incidentCount={0} mode="open" onModeChange={() => {}} />);
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Incidents" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Investigate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sigmon health" })).toBeInTheDocument();
  });
  it("navigates to the existing errors route", async () => {
    const onNavigate = vi.fn();
    render(<NavRail active="overview" onNavigate={onNavigate} incidentCount={0} mode="open" onModeChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Errors" }));
    expect(onNavigate).toHaveBeenCalledWith("investigate");
  });
  it("reports active incidents and keeps zero separate from unavailable", () => {
    const { rerender } = render(<NavRail active="overview" onNavigate={() => {}} incidentCount={3} mode="open" onModeChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Incidents, 3 active in selected environment" })).toBeInTheDocument();
    rerender(<NavRail active="overview" onNavigate={() => {}} incidentCount={0} mode="open" onModeChange={() => {}} />);
    expect(screen.queryByText("3")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Incidents" })).toBeInTheDocument();
    rerender(<NavRail active="overview" onNavigate={() => {}} incidentCount={null} mode="open" onModeChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Incidents, count unavailable" })).toBeInTheDocument();
  });
  it("offers all three navigation preferences", async () => {
    const onModeChange = vi.fn();
    render(<NavRail active="overview" onNavigate={() => {}} incidentCount={0} mode="open" onModeChange={onModeChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Navigation display" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Automatic" }));
    expect(onModeChange).toHaveBeenCalledWith("auto");
  });
  it("reveals automatic navigation for keyboard focus and closes on Escape", () => {
    render(<NavRail active="overview" onNavigate={() => {}} incidentCount={0} mode="auto" onModeChange={() => {}} />);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    fireEvent.focus(screen.getByRole("button", { name: "Errors" }));
    expect(nav).toHaveAttribute("data-expanded", "true");
    fireEvent.keyDown(nav, { key: "Escape" });
    expect(nav).toHaveAttribute("data-expanded", "false");
  });
});
