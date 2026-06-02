import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleModeTabs } from "./ConsoleModeTabs";

afterEach(() => {
  cleanup();
});

describe("ConsoleModeTabs", () => {
  it("renders project workspace and sigmon admin groups", () => {
    const onChange = vi.fn();

    render(<ConsoleModeTabs activeMode="project-settings" onChange={onChange} />);

    expect(screen.getByText("Project Workspace")).toBeInTheDocument();
    expect(screen.getByText("Sigmon Admin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Operations" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Investigate" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Alerts" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Monitors" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Artifacts" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Project Settings" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "System Health" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Onboarding" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("link", { name: "SDK Docs" })).toHaveAttribute("href", "/sdk");
  });

  it("switches modes", async () => {
    const onChange = vi.fn();

    render(<ConsoleModeTabs activeMode="setup" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Overview" }));
    await userEvent.click(screen.getByRole("button", { name: "Operations" }));
    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));
    await userEvent.click(screen.getByRole("button", { name: "Alerts" }));
    await userEvent.click(screen.getByRole("button", { name: "Monitors" }));
    await userEvent.click(screen.getByRole("button", { name: "Artifacts" }));
    await userEvent.click(screen.getByRole("button", { name: "Project Settings" }));
    await userEvent.click(screen.getByRole("button", { name: "System Health" }));
    await userEvent.click(screen.getByRole("button", { name: "Onboarding" }));

    expect(onChange).toHaveBeenCalledWith("overview");
    expect(onChange).toHaveBeenCalledWith("operations");
    expect(onChange).toHaveBeenCalledWith("investigate");
    expect(onChange).toHaveBeenCalledWith("alerts");
    expect(onChange).toHaveBeenCalledWith("monitors");
    expect(onChange).toHaveBeenCalledWith("artifacts");
    expect(onChange).toHaveBeenCalledWith("project-settings");
    expect(onChange).toHaveBeenCalledWith("system");
    expect(onChange).toHaveBeenCalledWith("setup");
  });
});
