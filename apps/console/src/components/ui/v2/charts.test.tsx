// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Bars, MicroSpark, Sparkline, StackedArea } from "./charts";

afterEach(cleanup);

describe("charts", () => {
  it("Sparkline draws a line path and a gradient fill by default", () => {
    const { container } = render(<Sparkline data={[1, 4, 2, 8, 5]} />);
    expect(container.querySelectorAll("path").length).toBe(2); // area + line
    expect(container.querySelector("linearGradient")).not.toBeNull();
  });

  it("Sparkline omits the fill path when fill={false}", () => {
    const { container } = render(<Sparkline data={[1, 4, 2]} fill={false} />);
    expect(container.querySelectorAll("path").length).toBe(1);
  });

  it("Sparkline tolerates a flat series without throwing", () => {
    expect(() => render(<Sparkline data={[0, 0, 0]} />)).not.toThrow();
  });

  it("Bars highlights the given index with the critical color", () => {
    const { container } = render(<Bars data={[1, 2, 3]} highlight={1} />);
    const wrap = container.querySelector("div") as HTMLElement;
    const bars = Array.from(wrap.children) as HTMLElement[];
    expect(bars[1].style.background).toContain("--sev-critical");
  });

  it("MicroSpark renders a single non-scaling path at the requested size", () => {
    const { container } = render(<MicroSpark data={[1, 2, 1, 3]} width={52} height={16} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("52");
    expect(container.querySelectorAll("path").length).toBe(1);
  });
});

describe("StackedArea", () => {
  it("renders one filled path per series plus baseline gridlines", () => {
    const { container } = render(
      <StackedArea
        buckets={["a", "b", "c"]}
        series={[
          { model: "gpt-5", color: "var(--sev-violet)", costs: [1, 2, 3] },
          { model: "haiku-4", color: "var(--accent)", costs: [0, 1, 2] },
        ]}
      />
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelectorAll("path").length).toBe(2);
    expect(container.querySelectorAll("line").length).toBe(5);
  });

  it("returns null for empty series", () => {
    const { container } = render(<StackedArea buckets={[]} series={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("does not crash on a single bucket", () => {
    const { container } = render(
      <StackedArea buckets={["a"]} series={[{ model: "m", color: "red", costs: [5] }]} />
    );
    expect(container.querySelectorAll("path").length).toBe(1);
  });
});
