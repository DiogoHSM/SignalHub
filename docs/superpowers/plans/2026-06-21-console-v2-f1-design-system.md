# Console v2 — F1 Design System & Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the v2 design system — a `.sh-v2`-scoped dark token layer, self-hosted Geist + JetBrains Mono, and a typed React primitive library — without touching any legacy screen.

**Architecture:** All v2 CSS is scoped under a `.sh-v2` wrapper class (legacy `styles.css` keeps its own `:root` tokens with the *same names* but different values, so scoping is mandatory to avoid collisions). Primitives are ported 1:1 from the committed design source (`.claude/design-v2/app-shared.jsx`, `app-screens-common.jsx`, `tokens.css`) into typed `.tsx` modules under `apps/console/src/components/ui/v2/`, each independently tested.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + @testing-library/react + jsdom, `@fontsource/geist-sans`, `@fontsource/jetbrains-mono`.

## Global Constraints

- Package: `@sigmon/console` (run commands with `pnpm --filter @sigmon/console <script>`).
- Theme: **dark-only**, v2 `tokens.css` values verbatim (oklch). No light variant. No oklch fallback layer.
- **Scope every v2 CSS rule under `.sh-v2`.** Never emit an unscoped `:root`, `html`, or `body` rule in v2 CSS — that would repaint the legacy console.
- Fonts: **self-hosted** via `@fontsource`. No Google Fonts CDN `<link>`.
- Fidelity is a feature: chart SVG math (viewBox, `0.92`/`0.84` insets, `vectorEffect="non-scaling-stroke"`, stroke widths, gradient opacities), font sizes, spacing, and `tabular-nums` are copied exactly from the design source — do not "tidy" them.
- Port the design's hand-drawn `Icon` glyph set — **do not** substitute `lucide-react` (already a dep, used by legacy only).
- Tests colocate with source (`*.test.tsx`), `afterEach(cleanup)`, follow the existing `src/components/ui/ConfirmActionButton.test.tsx` pattern.
- Design source of truth lives in-repo at `.claude/design-v2/` — cited by exact path per task; "copy verbatim from <path>" means the literal block in that file, which is committed and present.

---

### Task 1: v2 CSS scaffold + self-hosted fonts

Stand up the scoped stylesheet layer and bundle the fonts. No components yet.

**Files:**
- Modify: `apps/console/package.json` (add two deps)
- Create: `apps/console/src/styles/v2/tokens.css`
- Create: `apps/console/src/styles/v2/base.css`
- Create: `apps/console/src/styles/v2/components.css`
- Create: `apps/console/src/styles/v2/keyframes.css`
- Create: `apps/console/src/styles/v2/index.css`
- Modify: `apps/console/src/main.tsx` (import the v2 entry after `styles.css`)
- Create: `apps/console/src/styles/v2/styles-v2.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `.sh-v2` scope and its custom properties (`--bg-*`, `--border-*`, `--fg-*`, `--accent*`, `--sev-*`, `--font-sans`, `--font-mono`, `--r-*`, `--shadow-*`); the class layer (`.sh-card`, `.sh-card__head`, `.sh-card__body`, `.sh-tag` + tones, `.sh-btn` + variants, `.sh-kpi*`, `.sh-row*`, `.sh-segmented`, `.sh-input`, `.sh-code` + `.tok-*`, `.sh-stripe*`, `.sh-bars`, `.sh-h1/.sh-h2/.sh-h3/.sh-eyebrow/.sh-mono/.sh-muted/.sh-faint`); keyframes `sh-ping`, `sh-pulse`. All consumed by every later task and by F2/screens.

- [ ] **Step 1: Write the failing CSS-contract test**

Create `apps/console/src/styles/v2/styles-v2.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @sigmon/console test -- styles-v2`
Expected: FAIL — files don't exist (`ENOENT`).

- [ ] **Step 3: Add the font dependencies**

In `apps/console/package.json` `dependencies`, add:

```json
"@fontsource/geist-sans": "^5.1.0",
"@fontsource/jetbrains-mono": "^5.1.0",
```

Then install:

Run: `pnpm install`

> If either package or version is not on the registry, fall back to vendoring the woff2 files
> under `apps/console/src/styles/v2/fonts/` and writing `@font-face` blocks (Geist 400/500/600/700,
> JetBrains Mono 400/500/600) in `index.css` instead of the `@fontsource` imports in Step 7.

- [ ] **Step 4: Create `tokens.css` (scoped tokens)**

Create `apps/console/src/styles/v2/tokens.css` by copying the `:root { … }` token block **verbatim** from `.claude/design-v2/tokens.css` (the block ending before `* { box-sizing }`), with the single change `:root {` → `.sh-v2 {`. Include every property: surfaces, borders, text, accent, all severity groups, `--font-sans`/`--font-mono`, radii, shadows.

- [ ] **Step 5: Create `base.css` (scoped base element styles)**

Create `apps/console/src/styles/v2/base.css`. Port the design's global element styles, each scoped:

```css
.sh-v2 {
  background: var(--bg-base);
  color: var(--fg);
  font-family: var(--font-sans);
  font-feature-settings: "ss01", "ss02", "cv01";
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.sh-v2 * { box-sizing: border-box; }
.sh-v2 button { font: inherit; color: inherit; cursor: pointer; }
.sh-v2 code, .sh-v2 kbd, .sh-v2 samp { font-family: var(--font-mono); }
```

- [ ] **Step 6: Create `components.css` (scoped class layer)**

Create `apps/console/src/styles/v2/components.css` by copying every class rule from the `===== …` sections of `.claude/design-v2/tokens.css` (everything **after** the `code, kbd, samp` line: typography helpers, cards, badges/tags, buttons, KPI tile, tables/lists, spark/chart elements, severity stripe, segmented control, inputs, code block) and prefixing each selector with `.sh-v2 ` (e.g. `.sh-card {` → `.sh-v2 .sh-card {`, `.sh-tag.critical {` → `.sh-v2 .sh-tag.critical {`). Do **not** copy the `.sh-screen`/`.sh-rail`/`.sh-main`/`.sh-topbar`/`.sh-workspace`/`.sh-content` shell-layout blocks — those belong to F2.

- [ ] **Step 7: Create `keyframes.css` and `index.css`**

`apps/console/src/styles/v2/keyframes.css`:

```css
@keyframes sh-ping { 0% { transform: scale(.6); opacity: .6; } 80%, 100% { transform: scale(2.2); opacity: 0; } }
@keyframes sh-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
```

`apps/console/src/styles/v2/index.css`:

```css
@import "@fontsource/geist-sans/400.css";
@import "@fontsource/geist-sans/500.css";
@import "@fontsource/geist-sans/600.css";
@import "@fontsource/geist-sans/700.css";
@import "@fontsource/jetbrains-mono/400.css";
@import "@fontsource/jetbrains-mono/500.css";
@import "@fontsource/jetbrains-mono/600.css";
@import "./tokens.css";
@import "./base.css";
@import "./components.css";
@import "./keyframes.css";
```

- [ ] **Step 8: Wire into `main.tsx`**

In `apps/console/src/main.tsx`, add after the existing `import "./styles.css";`:

```ts
import "./styles/v2/index.css";
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter @sigmon/console test -- styles-v2`
Expected: PASS (4 tests).

- [ ] **Step 10: Verify the build picks up fonts + CSS**

Run: `pnpm --filter @sigmon/console build`
Expected: build succeeds; font woff2 assets emitted.

- [ ] **Step 11: Commit**

```bash
git add apps/console/package.json apps/console/pnpm-lock.yaml pnpm-lock.yaml apps/console/src/styles/v2 apps/console/src/main.tsx
git commit -m "feat(console-v2): scoped v2 token layer + self-hosted fonts (PER-342)"
```

---

### Task 2: status helpers module

**Files:**
- Create: `apps/console/src/components/ui/v2/status.ts`
- Test: `apps/console/src/components/ui/v2/status.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Status = "ok" | "warning" | "critical" | "idle"`; `STATUS: Record<Status, { color: string; bg: string; border: string; label: string }>`; `sev(status: string): StatusEntry` (falls back to `STATUS.idle`).

- [ ] **Step 1: Write the failing test**

Create `apps/console/src/components/ui/v2/status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { STATUS, sev, type Status } from "./status";

describe("status helpers", () => {
  it("maps each known status to its accent var", () => {
    expect(STATUS.ok.color).toBe("var(--accent)");
    expect(STATUS.critical.color).toBe("var(--sev-critical)");
    expect(STATUS.warning.label).toBe("Atenção");
  });

  it("sev() falls back to idle for unknown input", () => {
    expect(sev("nope")).toBe(STATUS.idle);
    expect(sev("ok" satisfies Status)).toBe(STATUS.ok);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sigmon/console test -- v2/status`
Expected: FAIL — `./status` not found.

- [ ] **Step 3: Implement**

Create `apps/console/src/components/ui/v2/status.ts`, porting the `STATUS`/`sev` block verbatim from `.claude/design-v2/app-shared.jsx`, typed:

```ts
export type Status = "ok" | "warning" | "critical" | "idle";
export type StatusEntry = { color: string; bg: string; border: string; label: string };

export const STATUS: Record<Status, StatusEntry> = {
  ok:       { color: "var(--accent)",       bg: "var(--accent-bg-subtle)", border: "var(--accent-border)",       label: "Operacional" },
  warning:  { color: "var(--sev-warning)",  bg: "var(--sev-warning-bg)",   border: "var(--sev-warning-border)",  label: "Atenção" },
  critical: { color: "var(--sev-critical)", bg: "var(--sev-critical-bg)",  border: "var(--sev-critical-border)", label: "Crítico" },
  idle:     { color: "var(--fg-muted)",     bg: "var(--bg-surface-3)",     border: "var(--border-subtle)",       label: "Inativo" }
};

export const sev = (s: string): StatusEntry => (STATUS as Record<string, StatusEntry>)[s] ?? STATUS.idle;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @sigmon/console test -- v2/status`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/ui/v2/status.ts apps/console/src/components/ui/v2/status.test.ts
git commit -m "feat(console-v2): status helpers (PER-342)"
```

---

### Task 3: Icon component

**Files:**
- Create: `apps/console/src/components/ui/v2/icon.tsx`
- Test: `apps/console/src/components/ui/v2/icon.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `type IconName` (union of all glyph keys); `Icon: (props: { name: IconName; size?: number; stroke?: number; style?: React.CSSProperties }) => JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `apps/console/src/components/ui/v2/icon.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sigmon/console test -- v2/icon`
Expected: FAIL — `./icon` not found.

- [ ] **Step 3: Implement**

Create `apps/console/src/components/ui/v2/icon.tsx`. Port the `Icon` component **verbatim** from `.claude/design-v2/app-shared.jsx` (the full `paths` glyph table — all ~55 entries — unchanged), wrapped with types:

```tsx
import type { CSSProperties, ReactNode } from "react";

const PATHS = {
  // ⇩ copy every entry from the `paths` object in
  //   .claude/design-v2/app-shared.jsx, verbatim (home, activity, error, … link).
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({
  name, size = 16, stroke = 1.6, style,
}: { name: IconName; size?: number; stroke?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      style={style}
    >
      {PATHS[name]}
    </svg>
  );
}
```

(The JSX path fragments use `<>…</>`; keep them exactly as in the source so every glyph matches.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @sigmon/console test -- v2/icon`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/ui/v2/icon.tsx apps/console/src/components/ui/v2/icon.test.tsx
git commit -m "feat(console-v2): Icon glyph set (PER-342)"
```

---

### Task 4: StatusDot

**Files:**
- Create: `apps/console/src/components/ui/v2/status-dot.tsx`
- Test: `apps/console/src/components/ui/v2/status-dot.test.tsx`

**Interfaces:**
- Consumes: `sev`, `Status` from `./status`.
- Produces: `StatusDot: (props: { status: Status; size?: number; pulse?: boolean }) => JSX.Element`.

- [ ] **Step 1: Write the failing test**

```tsx
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sigmon/console test -- v2/status-dot`
Expected: FAIL.

- [ ] **Step 3: Implement**

Port `StatusDot` from `.claude/design-v2/app-shared.jsx`, typed; import `sev`, `Status` from `./status`. Keep the inline styles and the `sh-ping` animation reference verbatim.

```tsx
import { sev, type Status } from "./status";

export function StatusDot({ status, size = 8, pulse = false }: { status: Status; size?: number; pulse?: boolean }) {
  const c = sev(status).color;
  return (
    <span style={{ position: "relative", display: "inline-flex", width: size, height: size, flex: "0 0 auto" }}>
      {pulse && status !== "ok" ? (
        <span style={{ position: "absolute", inset: -2, borderRadius: "50%", background: c, opacity: 0.35, animation: "sh-ping 1.8s cubic-bezier(0,0,.2,1) infinite" }} />
      ) : null}
      <span style={{ width: size, height: size, borderRadius: "50%", background: c, position: "relative" }} />
    </span>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @sigmon/console test -- v2/status-dot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/ui/v2/status-dot.tsx apps/console/src/components/ui/v2/status-dot.test.tsx
git commit -m "feat(console-v2): StatusDot (PER-342)"
```

---

### Task 5: charts (Sparkline, Bars, MicroSpark)

**Files:**
- Create: `apps/console/src/components/ui/v2/charts.tsx`
- Test: `apps/console/src/components/ui/v2/charts.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Sparkline: (props: { data: number[]; color?: string; height?: number; fill?: boolean }) => JSX.Element`
  - `Bars: (props: { data: number[]; color?: string; height?: number; highlight?: number | null }) => JSX.Element`
  - `MicroSpark: (props: { data: number[]; color?: string; width?: number; height?: number }) => JSX.Element`

- [ ] **Step 1: Write the failing test**

```tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Bars, MicroSpark, Sparkline } from "./charts";

afterEach(cleanup);

describe("charts", () => {
  it("Sparkline draws a line path and a gradient fill by default", () => {
    const { container } = render(<Sparkline data={[1, 4, 2, 8, 5]} />);
    expect(container.querySelectorAll("path").length).toBe(2); // area + line
    expect(container.querySelector("linearGradient")).not.toBeNull();
  });

  it("Sparkline omits the fill path when fill={false}", () => {
    const { container } = render(<Sparkline data={[1, 4, 2]} fill={false} />);
    expect(container.querySelectorAll("path").length).toBe(1);
  });

  it("Sparkline tolerates a flat series without throwing", () => {
    expect(() => render(<Sparkline data={[0, 0, 0]} />)).not.toThrow();
  });

  it("Bars highlights the given index with the critical color", () => {
    const { container } = render(<Bars data={[1, 2, 3]} highlight={1} />);
    const bars = container.querySelectorAll<HTMLElement>("div > div");
    expect(bars[1].style.background).toContain("--sev-critical");
  });

  it("MicroSpark renders a single non-scaling path at the requested size", () => {
    const { container } = render(<MicroSpark data={[1, 2, 1, 3]} width={52} height={16} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("52");
    expect(container.querySelectorAll("path").length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sigmon/console test -- v2/charts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/console/src/components/ui/v2/charts.tsx`, porting `Sparkline`, `Bars`, `MicroSpark` **verbatim** from `.claude/design-v2/app-shared.jsx` with prop types added. **One required change in `Sparkline`:** replace the design's
`const gradId = "g" + Math.random().toString(36).slice(2, 8);` with React's `useId()`:

```tsx
import { useId, type CSSProperties } from "react";

export function Sparkline({ data, color = "var(--accent)", height = 36, fill = true }:
  { data: number[]; color?: string; height?: number; fill?: boolean }) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 100, h = 100;
  const stepX = w / Math.max(data.length - 1, 1);
  const points = data.map((v, i) => [i * stepX, h - ((v - min) / range) * (h * 0.92) - 4]);
  const d = points.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const dArea = `${d} L${w},${h} L0,${h} Z`;
  const rawId = useId();
  const gradId = `g${rawId.replace(/[:]/g, "")}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }} aria-hidden="true">
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={dArea} fill={`url(#${gradId})`} />
        </>
      ) : null}
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
```

Then port `Bars` and `MicroSpark` verbatim from the source with these signatures:

```tsx
export function Bars({ data, color = "var(--accent)", height = 60, highlight = null }:
  { data: number[]; color?: string; height?: number; highlight?: number | null }) { /* …verbatim… */ }

export function MicroSpark({ data, color = "var(--accent)", width = 56, height = 18 }:
  { data: number[]; color?: string; width?: number; height?: number }) { /* …verbatim… */ }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @sigmon/console test -- v2/charts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/ui/v2/charts.tsx apps/console/src/components/ui/v2/charts.test.tsx
git commit -m "feat(console-v2): Sparkline/Bars/MicroSpark charts (PER-342)"
```

---

### Task 6: layout primitives (PageHead, Segmented, SummaryStat, Divider, Legend, Kv, Card)

**Files:**
- Create: `apps/console/src/components/ui/v2/primitives.tsx`
- Test: `apps/console/src/components/ui/v2/primitives.test.tsx`

**Interfaces:**
- Consumes: nothing (pure markup).
- Produces:
  - `PageHead: (props: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) => JSX.Element`
  - `Segmented: (props: { options: string[]; value: string; onChange?: (v: string) => void }) => JSX.Element`
  - `SummaryStat: (props: { label: ReactNode; value: ReactNode; delta?: ReactNode; tone?: "danger" | "ok"; mono?: boolean }) => JSX.Element`
  - `Divider: () => JSX.Element`
  - `Legend: (props: { color: string; label: ReactNode }) => JSX.Element`
  - `Kv: (props: { k: ReactNode; v: ReactNode; mono?: boolean; tone?: "danger" | null }) => JSX.Element`
  - `Card: (props: { title?: ReactNode; actions?: ReactNode; flush?: boolean; className?: string; style?: CSSProperties; children: ReactNode }) => JSX.Element`

- [ ] **Step 1: Write the failing test**

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Card, PageHead, Segmented } from "./primitives";

afterEach(cleanup);

describe("primitives", () => {
  it("PageHead renders title, sub and actions", () => {
    render(<PageHead title="Overview" sub="pulse" actions={<button>Export</button>} />);
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText("pulse")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("Segmented marks the active option and reports changes", async () => {
    const onChange = vi.fn();
    render(<Segmented options={["24h", "7d"]} value="24h" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "24h" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "7d" }));
    expect(onChange).toHaveBeenCalledWith("7d");
  });

  it("Card renders a header only when a title is given", () => {
    const { rerender, container } = render(<Card>body</Card>);
    expect(container.querySelector(".sh-card__head")).toBeNull();
    rerender(<Card title="Head">body</Card>);
    expect(container.querySelector(".sh-card__head")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sigmon/console test -- v2/primitives`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/console/src/components/ui/v2/primitives.tsx`. Port `PageHead`, `Segmented`, `SummaryStat`, `Divider`, `Legend`, `Kv` **verbatim** from `.claude/design-v2/app-screens-common.jsx` with the signatures above. Add the new `Card` wrapper emitting the v2 card structure:

```tsx
import type { CSSProperties, ReactNode } from "react";

export function Card({ title, actions, flush, className, style, children }:
  { title?: ReactNode; actions?: ReactNode; flush?: boolean; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className={`sh-card${className ? ` ${className}` : ""}`} style={style}>
      {title != null || actions != null ? (
        <div className="sh-card__head">
          {title != null ? <h2 className="sh-h2">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      <div className={`sh-card__body${flush ? " flush" : ""}`}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @sigmon/console test -- v2/primitives`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/ui/v2/primitives.tsx apps/console/src/components/ui/v2/primitives.test.tsx
git commit -m "feat(console-v2): layout primitives + Card (PER-342)"
```

---

### Task 7: pills + BigKpi (StatusPill, PriorityPill, BigKpi)

**Files:**
- Create: `apps/console/src/components/ui/v2/pills.tsx`
- Test: `apps/console/src/components/ui/v2/pills.test.tsx`

**Interfaces:**
- Consumes: `Sparkline` from `./charts`.
- Produces:
  - `StatusPill: (props: { status: "open" | "investigating" | "resolved" | "ignored" }) => JSX.Element`
  - `PriorityPill: (props: { p: "P1" | "P2" | "P3" | "P4" }) => JSX.Element`
  - `BigKpi: (props: { label: ReactNode; value: ReactNode; sub?: ReactNode; delta?: ReactNode; deltaDir?: "up" | "down"; spark?: number[]; color?: string }) => JSX.Element`

- [ ] **Step 1: Write the failing test**

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BigKpi, PriorityPill, StatusPill } from "./pills";

afterEach(cleanup);

describe("pills", () => {
  it("StatusPill labels investigating", () => {
    render(<StatusPill status="investigating" />);
    expect(screen.getByText("Investigating")).toBeInTheDocument();
  });

  it("PriorityPill shows the priority code", () => {
    render(<PriorityPill p="P1" />);
    expect(screen.getByText("P1")).toBeInTheDocument();
  });

  it("BigKpi renders a sparkline when spark data is given", () => {
    const { container } = render(<BigKpi label="Calls" value="184K" spark={[1, 2, 3]} color="var(--sev-violet)" />);
    expect(screen.getByText("184K")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sigmon/console test -- v2/pills`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/console/src/components/ui/v2/pills.tsx`. Port `StatusPill`, `PriorityPill`, `BigKpi` **verbatim** from `.claude/design-v2/app-screens-common.jsx`, typed as above; import `Sparkline` from `./charts`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @sigmon/console test -- v2/pills`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/ui/v2/pills.tsx apps/console/src/components/ui/v2/pills.test.tsx
git commit -m "feat(console-v2): StatusPill/PriorityPill/BigKpi (PER-342)"
```

---

### Task 8: SecretField

**Files:**
- Create: `apps/console/src/components/ui/v2/secret-field.tsx`
- Test: `apps/console/src/components/ui/v2/secret-field.test.tsx`

**Interfaces:**
- Consumes: `Icon` from `./icon`.
- Produces: `SecretField: (props: { value: string; masked?: boolean }) => JSX.Element`. Masks via `value.replace(/.(?=.{4})/g, "•")` (last 4 chars visible), reveal toggle, copy to real clipboard with "Copiado" feedback (1.4s).

- [ ] **Step 1: Write the failing test**

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretField } from "./secret-field";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("SecretField", () => {
  it("masks all but the last four characters by default", () => {
    render(<SecretField value="sh_live_abcd1234" />);
    expect(screen.getByText(/•+1234$/)).toBeInTheDocument();
  });

  it("reveals the value when the eye is toggled", async () => {
    render(<SecretField value="sh_live_abcd1234" />);
    await userEvent.click(screen.getByTitle("Revelar"));
    expect(screen.getByText("sh_live_abcd1234")).toBeInTheDocument();
  });

  it("copies the value to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<SecretField value="sh_live_abcd1234" />);
    await userEvent.click(screen.getByRole("button", { name: /Copy/ }));
    expect(writeText).toHaveBeenCalledWith("sh_live_abcd1234");
    expect(await screen.findByText("Copiado")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sigmon/console test -- v2/secret-field`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/console/src/components/ui/v2/secret-field.tsx`, porting `SecretField` from `.claude/design-v2/app-screens-common.jsx`, but wire the copy button to the **real clipboard** (the design stubs it). Mirror `src/components/ui/CopyButton.tsx`'s guard (`navigator.clipboard?.writeText`). Import `Icon` from `./icon`.

```tsx
import { useState } from "react";
import { Icon } from "./icon";

export function SecretField({ value, masked = true }: { value: string; masked?: boolean }) {
  const [reveal, setReveal] = useState(!masked);
  const [copied, setCopied] = useState(false);
  const shown = reveal ? value : value.replace(/.(?=.{4})/g, "•");
  async function copy() {
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) return;
    try {
      await writeText.call(navigator.clipboard, value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard denied — leave state unchanged */ }
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <div className="sh-code" style={{ flex: 1, padding: "9px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
        <span className="tok-str" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shown}</span>
      </div>
      <button className="sh-btn" onClick={() => setReveal((r) => !r)} title={reveal ? "Ocultar" : "Revelar"} type="button">
        <Icon name={reveal ? "eyeoff" : "eye"} size={13} />
      </button>
      <button className="sh-btn" onClick={() => void copy()} type="button">
        <Icon name={copied ? "check" : "copy"} size={13} />{copied ? "Copiado" : "Copy"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @sigmon/console test -- v2/secret-field`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/ui/v2/secret-field.tsx apps/console/src/components/ui/v2/secret-field.test.tsx
git commit -m "feat(console-v2): SecretField (PER-342)"
```

---

### Task 9: ConfirmButton

**Files:**
- Create: `apps/console/src/components/ui/v2/confirm-button.tsx`
- Test: `apps/console/src/components/ui/v2/confirm-button.test.tsx`

**Interfaces:**
- Consumes: `Icon`, `IconName` from `./icon`.
- Produces: `ConfirmButton: (props: { label: ReactNode; confirmLabel?: ReactNode; icon?: IconName; kind?: string; onConfirm: () => void }) => JSX.Element`. Two-step inline arm; auto-disarms after 2.6s.

- [ ] **Step 1: Write the failing test**

```tsx
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmButton } from "./confirm-button";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ConfirmButton", () => {
  it("arms on first click and fires onConfirm on the second", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Resolver" confirmLabel="Confirmar?" onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: /Resolver/ }));
    expect(screen.getByRole("button", { name: /Confirmar\?/ })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Confirmar\?/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("auto-disarms after the timeout", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ConfirmButton label="Resolver" confirmLabel="Confirmar?" onConfirm={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Resolver/ }));
    act(() => { vi.advanceTimersByTime(2700); });
    expect(screen.getByRole("button", { name: /Resolver/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sigmon/console test -- v2/confirm-button`
Expected: FAIL.

- [ ] **Step 3: Implement**

Port `ConfirmButton` from `.claude/design-v2/app-screens-common.jsx`, typed; import `Icon`, `IconName` from `./icon`.

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export function ConfirmButton({ label, confirmLabel = "Confirmar?", icon = "check", kind = "primary", onConfirm }:
  { label: ReactNode; confirmLabel?: ReactNode; icon?: IconName; kind?: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2600);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className={`sh-btn ${armed ? "danger" : kind}`} type="button"
      onClick={() => { if (armed) { onConfirm(); setArmed(false); } else setArmed(true); }}>
      <Icon name={armed ? "alert" : icon} size={14} />{armed ? confirmLabel : label}
    </button>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @sigmon/console test -- v2/confirm-button`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/ui/v2/confirm-button.tsx apps/console/src/components/ui/v2/confirm-button.test.tsx
git commit -m "feat(console-v2): ConfirmButton (PER-342)"
```

---

### Task 10: EmptyHint

**Files:**
- Create: `apps/console/src/components/ui/v2/empty-hint.tsx`
- Test: `apps/console/src/components/ui/v2/empty-hint.test.tsx`

**Interfaces:**
- Consumes: `Icon`, `IconName` from `./icon`.
- Produces: `EmptyHint: (props: { icon?: IconName; title: ReactNode; sub?: ReactNode; cta?: ReactNode }) => JSX.Element`.

- [ ] **Step 1: Write the failing test**

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyHint } from "./empty-hint";

afterEach(cleanup);

describe("EmptyHint", () => {
  it("renders title, sub and cta", () => {
    render(<EmptyHint title="Nothing here" sub="all clear" cta={<button>Add</button>} />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("all clear")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sigmon/console test -- v2/empty-hint`
Expected: FAIL.

- [ ] **Step 3: Implement**

Port `EmptyHint` from `.claude/design-v2/app-screens-common.jsx`, typed; import `Icon`, `IconName` from `./icon`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @sigmon/console test -- v2/empty-hint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/ui/v2/empty-hint.tsx apps/console/src/components/ui/v2/empty-hint.test.tsx
git commit -m "feat(console-v2): EmptyHint (PER-342)"
```

---

### Task 11: Toast (presentational) + barrel export

**Files:**
- Create: `apps/console/src/components/ui/v2/toast.tsx`
- Test: `apps/console/src/components/ui/v2/toast.test.tsx`
- Create: `apps/console/src/components/ui/v2/index.ts`

**Interfaces:**
- Consumes: `Icon`, `IconName` from `./icon`.
- Produces:
  - `type Toast = { id: number; title: ReactNode; sub?: ReactNode; icon?: IconName; tone?: "ok" | "warn" | "critical" }`
  - `ToastView: (props: { toast: Toast; onDismiss: (id: number) => void }) => JSX.Element` — single presentational toast (markup + `data-tone`). The queue/auto-dismiss controller is F2's job.
  - barrel `index.ts` re-exporting every v2 primitive + types.

- [ ] **Step 1: Write the failing test**

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastView, type Toast } from "./toast";

afterEach(cleanup);

const base: Toast = { id: 1, title: "Saved", sub: "all good", tone: "ok" };

describe("ToastView", () => {
  it("renders the title, sub and tone", () => {
    const { container } = render(<ToastView toast={base} onDismiss={vi.fn()} />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("all good")).toBeInTheDocument();
    expect(container.querySelector('[data-tone="ok"]')).not.toBeNull();
  });

  it("dismisses by id", async () => {
    const onDismiss = vi.fn();
    render(<ToastView toast={base} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Dispensar" }));
    expect(onDismiss).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sigmon/console test -- v2/toast`
Expected: FAIL.

- [ ] **Step 3: Implement the presentational toast**

Create `apps/console/src/components/ui/v2/toast.tsx`. Markup adapted from `ToastStack` in `.claude/design-v2/app-shell.jsx` (single-toast portion; the `.toast`/`.toast__*` CSS itself ships with F2's shell styles):

```tsx
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export type Toast = { id: number; title: ReactNode; sub?: ReactNode; icon?: IconName; tone?: "ok" | "warn" | "critical" };

export function ToastView({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  return (
    <div className="toast" data-tone={toast.tone}>
      <span className="toast__icon"><Icon name={toast.icon ?? "check"} size={15} /></span>
      <div style={{ flex: 1 }}>
        <div className="toast__title">{toast.title}</div>
        {toast.sub ? <div className="toast__sub">{toast.sub}</div> : null}
      </div>
      <button className="toast__x" onClick={() => onDismiss(toast.id)} aria-label="Dispensar" type="button">
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Create the barrel `index.ts`**

```ts
export * from "./status";
export * from "./icon";
export * from "./status-dot";
export * from "./charts";
export * from "./primitives";
export * from "./pills";
export * from "./secret-field";
export * from "./confirm-button";
export * from "./empty-hint";
export * from "./toast";
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @sigmon/console test -- v2/toast`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/components/ui/v2/toast.tsx apps/console/src/components/ui/v2/toast.test.tsx apps/console/src/components/ui/v2/index.ts
git commit -m "feat(console-v2): presentational Toast + ui/v2 barrel (PER-342)"
```

---

### Task 12: Full F1 verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full console test suite**

Run: `pnpm --filter @sigmon/console test`
Expected: PASS — all new `v2/*` tests plus the existing suite (no regressions; legacy tests untouched).

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter @sigmon/console lint && pnpm --filter @sigmon/console build`
Expected: both succeed (tsc `--noEmit` clean; production build emits font assets).

- [ ] **Step 3: Repo-wide gate**

Run: `pnpm test && pnpm build`
Expected: PASS (confirms F1 didn't break sibling packages).

- [ ] **Step 4: Manual fidelity spot-check (not shipped)**

Temporarily render a scratch component inside a `<div className="sh-v2">` that lays out one of each primitive (Icon row, StatusDot pulse, Sparkline/Bars/MicroSpark, BigKpi, Card, tags, buttons, Segmented, SecretField, ConfirmButton, EmptyHint, ToastView). `pnpm --filter @sigmon/console dev`, eyeball against `.claude/design-v2/tokens.css` + `app-shared.jsx` (colors, fonts loaded, stroke widths). Remove the scratch component before finishing — do not commit it.

- [ ] **Step 5: No-op commit guard**

Run: `git status --short`
Expected: clean working tree (scratch component removed). F1 complete.

---

## Notes for the implementer

- The design source files (`.claude/design-v2/*.jsx`, `tokens.css`) are committed and present — "copy verbatim from <path>" refers to the literal blocks there. When in doubt about a value, the design file wins.
- These are React 18 prototypes using a global `window`/`React` registry; you are porting to React 19 ES modules. Drop `Object.assign(window, …)`, add `import` statements, type the props as specified, otherwise keep markup and inline styles identical.
- Every v2 component must render inside a `.sh-v2` ancestor to get its tokens — that wrapper arrives in F2. F1 tests don't need it (they assert structure/behavior, not computed colors).
