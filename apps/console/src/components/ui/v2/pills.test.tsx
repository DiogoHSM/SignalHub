import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BigKpi, PriorityPill, StatusPill } from "./pills";

afterEach(cleanup);

describe("pills", () => {
  it("StatusPill labels investigating", () => {
    render(<StatusPill status="investigating" />);
    expect(screen.getByText("Investigating")).toBeInTheDocument();
  });

  it("PriorityPill shows the priority code", () => {
    render(<PriorityPill p="P1" />);
    expect(screen.getByText("P1")).toBeInTheDocument();
  });

  it("BigKpi renders a sparkline when spark data is given", () => {
    const { container } = render(<BigKpi label="Calls" value="184K" spark={[1, 2, 3]} color="var(--sev-violet)" />);
    expect(screen.getByText("184K")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
