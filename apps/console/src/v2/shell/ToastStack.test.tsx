import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Toast } from "../../components/ui/v2";
import { ToastStack } from "./ToastStack";

describe("ToastStack", () => {
  it("renders one ToastView per toast", () => {
    const toasts: Toast[] = [
      { id: 1, title: "First toast" },
      { id: 2, title: "Second toast", tone: "ok" }
    ];

    render(<ToastStack toasts={toasts} onDismiss={() => {}} />);

    expect(screen.getByText("First toast")).toBeInTheDocument();
    expect(screen.getByText("Second toast")).toBeInTheDocument();
  });

  it("renders empty when toasts array is empty", () => {
    const { container } = render(<ToastStack toasts={[]} onDismiss={() => {}} />);

    const toastStack = container.querySelector(".toast-stack");
    expect(toastStack).toBeInTheDocument();
    expect(toastStack?.children).toHaveLength(0);
  });

  it("calls onDismiss with toast id when dismiss button is clicked", async () => {
    const onDismiss = vi.fn();
    const toasts: Toast[] = [
      { id: 42, title: "Toast with id" }
    ];

    const user = userEvent.setup();
    const { container } = render(<ToastStack toasts={toasts} onDismiss={onDismiss} />);

    const dismissButtons = container.querySelectorAll('[aria-label="Dispensar"]');
    const dismissButton = dismissButtons[dismissButtons.length - 1]; // Get last one rendered
    await user.click(dismissButton);

    expect(onDismiss).toHaveBeenCalledWith(42);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders toast with correct data-tone attribute", () => {
    const { container } = render(
      <ToastStack
        toasts={[{ id: 1, title: "Critical toast", tone: "critical" }]}
        onDismiss={() => {}}
      />
    );

    const toast = container.querySelector('[data-tone="critical"]');
    expect(toast).toBeInTheDocument();
  });
});
