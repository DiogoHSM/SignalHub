import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Icon } from "./icon";

afterEach(cleanup);

describe("Icon", () => {
  it("renders an svg of the requested size for a known name", () => {
    const { container } = render(<Icon name="home" size={20} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("20");
    expect(svg?.querySelector("path")).not.toBeNull();
  });

  it("applies stroke width and default size", () => {
    const { container } = render(<Icon name="bell" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("stroke-width")).toBe("1.6");
  });
});
