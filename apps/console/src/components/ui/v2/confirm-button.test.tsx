import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmButton } from "./confirm-button";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ConfirmButton", () => {
  it("arms on first click and fires onConfirm on the second", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Resolver" confirmLabel="Confirm?" onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: /Resolver/ }));
    expect(screen.getByRole("button", { name: /Confirm Resolver\?/ })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Confirm Resolver\?/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("auto-disarms after the timeout", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ConfirmButton label="Resolver" confirmLabel="Confirm?" onConfirm={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Resolver/ }));
    act(() => { vi.advanceTimersByTime(2700); });
    expect(screen.getByRole("button", { name: /Resolver/ })).toBeInTheDocument();
  });

  it("gives the armed state an aria-label naming the pending action (default confirmLabel only)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ConfirmButton label="Delete" onConfirm={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Confirm Delete?" })).toBeInTheDocument();
  });

  it("leaves a caller-provided descriptive confirmLabel untouched (no aria-label override)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ConfirmButton label="Resolve" confirmLabel="Confirm resolution?" onConfirm={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Resolve" }));
    expect(screen.getByRole("button", { name: "Confirm resolution?" })).toBeInTheDocument();
  });

  it("does not add an aria-label when the visible label is an icon (no string to name the action)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = render(<ConfirmButton label={<span data-testid="icon" />} onConfirm={vi.fn()} />);
    await user.click(screen.getByRole("button"));
    expect(container.querySelector("button")).not.toHaveAttribute("aria-label");
  });

  it("does not change the 2600ms auto-disarm timeout", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ConfirmButton label="Delete" onConfirm={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    // Still armed well short of the timeout.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("button", { name: "Confirm Delete?" })).toBeInTheDocument();
    // Past 2600ms total, it auto-disarms back to the original label/name.
    act(() => { vi.advanceTimersByTime(1700); });
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});
