import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const consoleRoot = process.cwd().endsWith("apps/console") ? process.cwd() : join(process.cwd(), "apps", "console");
const read = (f: string) => readFileSync(join(consoleRoot, "src", "styles", "v2", f), "utf8");

describe("v2 design tokens are scoped to .sh-v2", () => {
  it("defines the token vars under .sh-v2, not :root", () => {
    const tokens = read("tokens.css");
    expect(tokens).toMatch(/\.sh-v2\s*{[^}]*--bg-base:\s*oklch/s);
    expect(tokens).toMatch(/--accent:\s*oklch\(0\.82 0\.17 145\)/);
    expect(tokens).not.toMatch(/:root\s*{/);
  });

  it("never repaints global html/body/* — base rules stay scoped", () => {
    const base = read("base.css");
    // every selector block must start with .sh-v2
    const selectors = base.match(/^[^@/\s][^{]*\{/gm) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) {
      expect(sel.trim()).toMatch(/^\.sh-v2\b/);
    }
  });

  it("scopes the component class layer under .sh-v2", () => {
    const components = read("components.css");
    expect(components).toMatch(/\.sh-v2 \.sh-card\s*{/);
    expect(components).toMatch(/\.sh-v2 \.sh-btn\.primary\s*{/);
  });

  it("ships sh-prefixed keyframes", () => {
    const kf = read("keyframes.css");
    expect(kf).toMatch(/@keyframes sh-ping/);
    expect(kf).toMatch(/@keyframes sh-pulse/);
  });
});
