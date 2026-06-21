import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Bars, MicroSpark, Sparkline } from "./charts";

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
    const bars = container.querySelectorAll<HTMLElement>("div > div");
    expect(bars[1].style.background).toContain("--sev-critical");
  });

  it("MicroSpark renders a single non-scaling path at the requested size", () => {
    const { container } = render(<MicroSpark data={[1, 2, 1, 3]} width={52} height={16} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("52");
    expect(container.querySelectorAll("path").length).toBe(1);
  });
});
