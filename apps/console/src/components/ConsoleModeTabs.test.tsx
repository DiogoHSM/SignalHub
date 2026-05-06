import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleModeTabs } from "./ConsoleModeTabs";

afterEach(() => {
  cleanup();
});

describe("ConsoleModeTabs", () => {
  it("renders setup overview investigate and system tabs", () => {
    const onChange = vi.fn();

    render(<ConsoleModeTabs activeMode="setup" onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Setup" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Investigate" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switches modes", async () => {
    const onChange = vi.fn();

    render(<ConsoleModeTabs activeMode="setup" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Overview" }));
    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));
    await userEvent.click(screen.getByRole("button", { name: "System" }));

    expect(onChange).toHaveBeenCalledWith("overview");
    expect(onChange).toHaveBeenCalledWith("investigate");
    expect(onChange).toHaveBeenCalledWith("system");
  });
});
