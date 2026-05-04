import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleModeTabs } from "./ConsoleModeTabs";

afterEach(() => {
  cleanup();
});

describe("ConsoleModeTabs", () => {
  it("shows the active mode and switches modes", async () => {
    const onChange = vi.fn();

    render(<ConsoleModeTabs activeMode="setup" onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Setup" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Investigate" })).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));

    expect(onChange).toHaveBeenCalledWith("investigate");
  });
});
