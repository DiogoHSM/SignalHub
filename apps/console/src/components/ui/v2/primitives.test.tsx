import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Card, PageHead, Segmented } from "./primitives";

afterEach(cleanup);

describe("primitives", () => {
  it("PageHead renders title, sub and actions", () => {
    render(<PageHead title="Overview" sub="pulse" actions={<button>Export</button>} />);
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText("pulse")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("Segmented marks the active option and reports changes", async () => {
    const onChange = vi.fn();
    render(<Segmented options={["24h", "7d"]} value="24h" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "24h" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "7d" }));
    expect(onChange).toHaveBeenCalledWith("7d");
  });

  it("Card renders a header only when a title is given", () => {
    const { rerender, container } = render(<Card>body</Card>);
    expect(container.querySelector(".sh-card__head")).toBeNull();
    rerender(<Card title="Head">body</Card>);
    expect(container.querySelector(".sh-card__head")).not.toBeNull();
  });
});
