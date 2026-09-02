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

  it("stacks audited investigation layouts and keeps wide rows locally scrollable from 900px to 1279px", () => {
    const medium = mediaBlocks(css, "(min-width: 900px) and (max-width: 1279px)");

    expect(medium).toMatch(/\.overview-attention[^{}]*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(medium).toMatch(/\.overview-signals[^{}]*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(medium).toMatch(/\.traces-detail-grid[^{}]*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(medium).toMatch(/\.tenant-panels[^{}]*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(medium).toMatch(/\.llm-panels[^{}]*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(medium).toMatch(/\.dashboards-layout[^{}]*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(medium).toMatch(/\.sh-table-scroll[^{}]*\{[^}]*overflow-x:\s*auto/s);
    expect(medium).toMatch(/\.sh-wide-table-scroll[^{}]*\{[^}]*overflow-x:\s*auto/s);
    expect(medium).toMatch(/\.sh-wide-table[^{}]*\{[^}]*min-width:\s*920px/s);
    expect(css).toMatch(/\.sh-wide-table__body[^{}]*\{[^}]*overflow-x:\s*clip[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.sh-wide-table-scroll--fill\s*>\s*\.sh-wide-table[^{}]*\{[^}]*height:\s*100%/s);
    expect(medium).toMatch(/\.page[^{}]*\{[^}]*overflow-x:\s*visible/s);
    expect(medium).toMatch(/\.tb-search\s*>\s*:where\(span,\s*kbd\)[^{}]*\{[^}]*display:\s*none/s);
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

  it.each([".hr-card__main", ".span-row"])("keeps the %s focus ring inside clipped row bounds", (selector) => {
    expect(css).toMatch(
      new RegExp(`${escapeRegExp(selector)}:focus-visible[^{}]*\\{[^}]*box-shadow:\\s*inset 0 0 0 2px var\\(--focus-ring\\)`, "s")
    );
  });

  it("keeps the span toggle compact inside a non-overlapping 44px hit slot", () => {
    expect(css).toMatch(/\.span-toggle-slot\s*\{[^}]*width:\s*44px[^}]*height:\s*16px[^}]*flex:\s*0 0 44px/s);
    expect(css).toMatch(/\.span-toggle\.sh-hit-target\s*\{[^}]*width:\s*16px[^}]*height:\s*16px[^}]*min-width:\s*16px[^}]*min-height:\s*16px[^}]*position:\s*relative/s);
    expect(css).toMatch(/\.span-toggle::before\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s);
    expect(css).toMatch(/\.span-toggle-placeholder\s*\{[^}]*width:\s*16px[^}]*height:\s*16px/s);
  });
});
