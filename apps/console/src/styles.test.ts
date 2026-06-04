import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("console CSS shell contract", () => {
  it("keeps viewport scrolling inside the console workspace with dark native chrome", () => {
    expect(css).toContain("color-scheme: dark");
    expect(css).toMatch(/html,\s*body,\s*#root\s*{[^}]*height:\s*100%[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.workspace\s*{[^}]*overflow-y:\s*auto/s);
  });

  it("uses themed scrollbars for internal console scrollers", () => {
    expect(css).toMatch(/\.console-shell\s+\*[^}]*scrollbar-color:\s*var\(--scrollbar-thumb\)\s+var\(--scrollbar-track\)/s);
    expect(css).toContain("--scrollbar-track:");
    expect(css).toContain("--scrollbar-thumb:");
    expect(css).toContain("--scrollbar-thumb-hover:");
  });
});
