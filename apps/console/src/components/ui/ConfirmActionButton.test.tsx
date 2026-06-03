import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmActionButton } from "./ConfirmActionButton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ConfirmActionButton", () => {
  it("does not call onConfirm when the confirmation is canceled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onConfirm = vi.fn();

    render(
      <ConfirmActionButton confirmMessage="Delete it?" onConfirm={onConfirm}>
        Delete
      </ConfirmActionButton>
    );

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(confirm).toHaveBeenCalledWith("Delete it?");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onConfirm when the confirmation is accepted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onConfirm = vi.fn();

    render(
      <ConfirmActionButton confirmMessage="Delete it?" onConfirm={onConfirm}>
        Delete
      </ConfirmActionButton>
    );

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not confirm or call onConfirm when disabled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onConfirm = vi.fn();

    render(
      <ConfirmActionButton confirmMessage="Delete it?" disabled onConfirm={onConfirm}>
        Delete
      </ConfirmActionButton>
    );

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(confirm).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("passes async rejections to onError", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const error = new Error("delete failed");
    const onConfirm = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();

    render(
      <ConfirmActionButton confirmMessage="Delete it?" onConfirm={onConfirm} onError={onError}>
        Delete
      </ConfirmActionButton>
    );

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("prevents duplicate confirms while async confirmation is pending", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let resolveConfirm: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        })
    );

    render(
      <ConfirmActionButton confirmMessage="Delete it?" onConfirm={onConfirm}>
        Delete
      </ConfirmActionButton>
    );

    await userEvent.dblClick(screen.getByRole("button", { name: "Delete" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);

    resolveConfirm();
  });
});
