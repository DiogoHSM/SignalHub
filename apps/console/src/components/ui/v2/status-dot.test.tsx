import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusDot } from "./status-dot";

afterEach(cleanup);

describe("StatusDot", () => {
  it("renders the dot in the severity color", () => {
    const { container } = render(<StatusDot status="critical" />);
    const dot = container.querySelector("span > span:last-child") as HTMLElement;
    expect(dot.style.background).toContain("--sev-critical");
  });

  it("renders the ping layer only when pulsing on a non-ok status", () => {
    const ping = render(<StatusDot status="critical" pulse />);
    expect(ping.container.querySelectorAll("span").length).toBe(3); // wrapper + ping + dot
    cleanup();
    const noPing = render(<StatusDot status="ok" pulse />);
    expect(noPing.container.querySelectorAll("span").length).toBe(2); // wrapper + dot
  });
});
