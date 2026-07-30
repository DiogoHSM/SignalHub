import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const consoleRoot = process.cwd().endsWith("apps/console") ? process.cwd() : join(process.cwd(), "apps", "console");
const css = readFileSync(join(consoleRoot, "src", "styles.css"), "utf8");

describe("console CSS shared contract", () => {
  it("keeps the v2 viewport root and dark authentication chrome", () => {
    expect(css).toContain("color-scheme: dark");
    expect(css).toMatch(/html,\s*body,\s*#root\s*{[^}]*height:\s*100%[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.auth-page\s*{[^}]*grid-template-columns:/s);
    expect(css).toMatch(/\.auth-form\s*{[^}]*background:\s*var\(--bg-surface\)/s);
    expect(css).toMatch(/\.center-panel\s*{/);
  });

  it("retains shared command palette and incident surfaces used by v2", () => {
    expect(css).toMatch(/\.command-palette__panel\s*{/);
    expect(css).toMatch(/\.incident-replay-panel\s*{/);
    expect(css).toMatch(/\.incident-replay-events__error\s*{/);
    expect(css).toMatch(/\.incident-code-context-card\s*{/);
    expect(css).toMatch(/\.incident-code-context__evidence-item\s*{/);
  });

  it("does not restore legacy shell or legacy island selectors", () => {
    expect(css).not.toMatch(/\.console-shell\b/);
    expect(css).not.toMatch(/\.console-legacy-island\b/);
    expect(css).not.toMatch(/\.overview-dashboard\b/);
    expect(css).not.toMatch(/\.investigation-workspace\b/);
  });
});
