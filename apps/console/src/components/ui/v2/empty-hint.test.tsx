import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyHint } from "./empty-hint";

afterEach(cleanup);

describe("EmptyHint", () => {
  it("renders title, sub and cta", () => {
    render(<EmptyHint title="Nothing here" sub="all clear" cta={<button>Add</button>} />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("all clear")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });
});
