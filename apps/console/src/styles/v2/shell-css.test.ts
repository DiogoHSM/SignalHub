import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const root = process.cwd().endsWith("apps/console") ? process.cwd() : join(process.cwd(), "apps", "console");
const css = readFileSync(join(root, "src", "styles", "v2", "shell.css"), "utf8");
describe("v2 shell css is scoped", () => {
  it("scopes layout classes under .sh-v2", () => {
    expect(css).toMatch(/\.sh-v2 \.app\s*\{/);
    expect(css).toMatch(/\.sh-v2 \.hr-card/);
    expect(css).toMatch(/\.sh-v2 \.toast\b/);
  });
  it("does not emit a bare html/body/#root rule", () => {
    expect(css).not.toMatch(/^\s*html\s*,\s*body/m);
    expect(css).not.toMatch(/^\s*#root\s*\{/m);
  });
  it("keeps the page-transition keyframes", () => {
    expect(css).toMatch(/@keyframes pgFwd/);
    expect(css).toMatch(/@keyframes toastIn/);
  });
});
