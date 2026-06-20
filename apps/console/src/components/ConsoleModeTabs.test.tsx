import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleModeTabs } from "./ConsoleModeTabs";

afterEach(() => {
  cleanup();
});

describe("ConsoleModeTabs", () => {
  it("renders global, project workspace, and sigmon admin groups", () => {
    const onChange = vi.fn();

    render(<ConsoleModeTabs activeMode="configure" onChange={onChange} />);

    expect(screen.getByLabelText("Global")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Project Workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Operations" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Analyze" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Traces" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Errors" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Experiments" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Configure" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Sigmon Admin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Admin" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("link", { name: "SDK Docs" })).toHaveAttribute("href", "/sdk");
  });

  it("switches modes", async () => {
    const onChange = vi.fn();

    render(<ConsoleModeTabs activeMode="home" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    await userEvent.click(screen.getByRole("button", { name: "Operations" }));
    await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await userEvent.click(screen.getByRole("button", { name: "Traces" }));
    await userEvent.click(screen.getByRole("button", { name: "Errors" }));
    await userEvent.click(screen.getByRole("button", { name: "Experiments" }));
    await userEvent.click(screen.getByRole("button", { name: "Configure" }));
    await userEvent.click(screen.getByRole("button", { name: "Admin" }));

    expect(onChange).toHaveBeenCalledWith("home");
    expect(onChange).toHaveBeenCalledWith("operations");
    expect(onChange).toHaveBeenCalledWith("analyze");
    expect(onChange).toHaveBeenCalledWith("traces");
    expect(onChange).toHaveBeenCalledWith("errors");
    expect(onChange).toHaveBeenCalledWith("experiments");
    expect(onChange).toHaveBeenCalledWith("configure");
    expect(onChange).toHaveBeenCalledWith("system");
  });
});
