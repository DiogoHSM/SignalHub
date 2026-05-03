import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the console scaffold", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "SignalHub Console" })).toBeInTheDocument();
    expect(screen.getByText("Console scaffold ready.")).toBeInTheDocument();
  });
});
