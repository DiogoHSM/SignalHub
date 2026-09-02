import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const root = process.cwd().endsWith("apps/console") ? process.cwd() : join(process.cwd(), "apps", "console");
const css = readFileSync(join(root, "src", "styles", "v2", "shell.css"), "utf8");
const componentsCss = readFileSync(join(root, "src", "styles", "v2", "components.css"), "utf8");
const mobileCss = readFileSync(join(root, "src", "v2", "mobile-status.css"), "utf8");
const keyframesCss = readFileSync(join(root, "src", "styles", "v2", "keyframes.css"), "utf8");

function mediaBlocks(source: string, query: string): string {
  const blocks: string[] = [];
  let cursor = 0;
  while ((cursor = source.indexOf(`@media ${query}`, cursor)) >= 0) {
    const openingBrace = source.indexOf("{", cursor);
    let depth = 1;
    let end = openingBrace + 1;
    while (end < source.length && depth > 0) {
      if (source[end] === "{") depth += 1;
      if (source[end] === "}") depth -= 1;
      end += 1;
    }
    blocks.push(source.slice(openingBrace + 1, end - 1));
    cursor = end;
  }
  return blocks.join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
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

  it("disables each named shell and status animation for reduced motion", () => {
    const reduced = mediaBlocks(`${css}\n${keyframesCss}`, "(prefers-reduced-motion: reduce)");
    const contracts = [
      ["pgFade", '.page[data-anim="nav"]'],
      ["pgFwd", '.page[data-anim="forward"]'],
      ["pgBack", '.page[data-anim="back"]'],
      ["menuIn", ".sw-menu"],
      ["toastIn", ".toast"],
      ["sh-pulse", ".hr-live__dot"],
      ["sh-ping", ".sh-status-dot__ping"]
    ] as const;

    expect(reduced).not.toBe("");
    for (const [animationName, selector] of contracts) {
      expect(`${css}\n${keyframesCss}`, `${animationName} must remain defined`).toContain(animationName);
      expect(reduced, `${selector} needs a targeted reduced-motion override`).toMatch(
        new RegExp(`${escapeRegExp(selector)}[^{}]*\\{[^}]*animation:\\s*none`, "s")
      );
    }
    expect(reduced).not.toMatch(/\.sh-v2\s+\*/);
  });

  it("preserves explicit accordion, menu, toast, and chevron final states", () => {
    const reduced = mediaBlocks(css, "(prefers-reduced-motion: reduce)");
    expect(reduced).toMatch(/\.hr-acc\[data-open="true"\][^{}]*\{[^}]*grid-template-rows:\s*1fr/s);
    expect(reduced).toMatch(/\.sw-menu[^{}]*\{[^}]*opacity:\s*1[^}]*transform:\s*none/s);
    expect(reduced).toMatch(/\.toast[^{}]*\{[^}]*opacity:\s*1[^}]*transform:\s*none/s);
    expect(reduced).toContain(".hr-expand");
    expect(reduced).toMatch(/transition-duration:\s*0\.01ms/);
  });

  it("defines one 44px shared hit target across desktop, component, and mobile styles", () => {
    const allCss = `${css}\n${componentsCss}\n${mobileCss}`;
    expect(allCss).toMatch(/\.sh-hit-target\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s);
    expect(allCss).toMatch(/\.sh-iconbtn-sm\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s);
  });

  it("shows a shared focus-visible ring on native and custom interactive controls", () => {
    const allCss = `${css}\n${componentsCss}\n${mobileCss}`;
    expect(allCss).toMatch(/:where\([^)]*button[^)]*\[role=["']button["'][^)]*\):focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\)[^}]*outline-offset:\s*2px/s);
  });
});
