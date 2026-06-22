import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderSection, SCREENS } from "./registry";

afterEach(cleanup);

describe("screen registry", () => {
  it("has an entry for every nav section", () => {
    for (const s of ["overview","investigate","incidents","llm","traces","alerts","system","settings"] as const)
      expect(SCREENS[s]).toBeDefined();
  });
  it("wraps legacy entries in the legacy island", () => {
    const { container } = render(<>{renderSection("overview", {} as any)}</>);
    expect(container.querySelector(".console-legacy-island")).not.toBeNull();
  });
});
