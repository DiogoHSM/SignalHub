import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastView, type Toast } from "./toast";

afterEach(cleanup);

const base: Toast = { id: 1, title: "Saved", sub: "all good", tone: "ok" };

describe("ToastView", () => {
  it("renders the title, sub and tone", () => {
    const { container } = render(<ToastView toast={base} onDismiss={vi.fn()} />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("all good")).toBeInTheDocument();
    expect(container.querySelector('[data-tone="ok"]')).not.toBeNull();
  });

  it("dismisses by id", async () => {
    const onDismiss = vi.fn();
    render(<ToastView toast={base} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith(1);
  });
});
