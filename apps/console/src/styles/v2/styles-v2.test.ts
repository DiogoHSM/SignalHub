import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const consoleRoot = process.cwd().endsWith("apps/console") ? process.cwd() : join(process.cwd(), "apps", "console");
const read = (f: string) => readFileSync(join(consoleRoot, "src", "styles", "v2", f), "utf8");

type Oklch = { l: number; c: number; h: number };

function readTokens(css: string): Map<string, Oklch> {
  const tokens = new Map<string, Oklch>();
  for (const match of css.matchAll(/(--[\w-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g)) {
    tokens.set(match[1], { l: Number(match[2]), c: Number(match[3]), h: Number(match[4]) });
  }
  return tokens;
}

function relativeLuminance({ l, c, h }: Oklch): number {
  const hue = h * Math.PI / 180;
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);
  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;
  const ll = lPrime ** 3;
  const mm = mPrime ** 3;
  const ss = sPrime ** 3;
  const clamp = (channel: number) => Math.max(0, Math.min(1, channel));
  const red = clamp(4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss);
  const green = clamp(-1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss);
  const blue = clamp(-0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(a: Oklch, b: Oklch): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

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

  it.each(["--fg-secondary", "--fg-muted", "--fg-faint"])(
    "keeps %s at 4.5:1 on every audited console surface",
    (foregroundName) => {
      const tokens = readTokens(read("tokens.css"));
      const foreground = tokens.get(foregroundName);
      expect(foreground, `${foregroundName} must be an explicit OKLCH token`).toBeDefined();

      for (const backgroundName of [
        "--bg-base",
        "--bg-canvas",
        "--bg-surface",
        "--bg-surface-2",
        "--bg-surface-3",
        "--bg-hover",
        "--bg-active"
      ]) {
        const background = tokens.get(backgroundName);
        expect(background, `${backgroundName} must be an explicit OKLCH token`).toBeDefined();
        const ratio = contrast(foreground!, background!);
        expect(
          ratio,
          `${foregroundName} on ${backgroundName} is ${ratio.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  );

  it("keeps the focus ring at 3:1 on every audited console surface", () => {
    const tokens = readTokens(read("tokens.css"));
    const focusRing = tokens.get("--focus-ring");
    expect(focusRing, "--focus-ring must be an explicit OKLCH token").toBeDefined();

    for (const backgroundName of [
      "--bg-base",
      "--bg-canvas",
      "--bg-surface",
      "--bg-surface-2",
      "--bg-surface-3",
      "--bg-hover",
      "--bg-active"
    ]) {
      const background = tokens.get(backgroundName)!;
      const ratio = contrast(focusRing!, background);
      expect(ratio, `--focus-ring on ${backgroundName} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });
});
