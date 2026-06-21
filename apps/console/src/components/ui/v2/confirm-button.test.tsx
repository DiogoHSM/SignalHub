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
    render(<ConfirmButton label="Resolver" confirmLabel="Confirmar?" onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: /Resolver/ }));
    expect(screen.getByRole("button", { name: /Confirmar\?/ })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Confirmar\?/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("auto-disarms after the timeout", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ConfirmButton label="Resolver" confirmLabel="Confirmar?" onConfirm={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Resolver/ }));
    act(() => { vi.advanceTimersByTime(2700); });
    expect(screen.getByRole("button", { name: /Resolver/ })).toBeInTheDocument();
  });
});
