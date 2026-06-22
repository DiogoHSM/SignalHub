# F1 · Console v2 — Design system & tokens

**Epic:** [SignalMonitor Console v2 — dark redesign](https://linear.app/data4ward/project/signalmonitor-console-v2-dark-redesign-d974e381fc64)
**Issue:** PER-342
**Date:** 2026-06-21
**Status:** Draft for review

## Goal

Land the v2 design system as the visual foundation every other v2 sub-project builds on:
the dark token set, self-hosted fonts, and a typed React primitive library that ports the
design's shared components at 1:1 fidelity. No screens or shell yet — just the toolkit.

Design source (mirrored in `.claude/design-v2/`): `tokens.css`, `app-shared.jsx`,
`app-screens-common.jsx`. These are the authority for every value (colors, sizes, stroke
widths, spacing). Match them exactly.

## Decisions (locked)

- **Theme:** dark-only, the v2 `tokens.css` palette (oklch), green accent, Geist + JetBrains Mono.
- **Coexistence:** v2 tokens are **scoped to a wrapper**, not global. Legacy light screens keep
  `styles.css` untouched until each screen is migrated. No broken intermediate UI.
- **Fonts:** **self-hosted** (bundled), no Google Fonts CDN. Offline/air-gapped safe.

## Architecture

### 1. Scoped token layer

The design's `tokens.css` declares its variables on `:root` and applies base styles to
`html, body` and `*`. Applying that globally would repaint the entire legacy console dark.
Instead we scope everything under a single wrapper class **`.sh-v2`** that the v2 shell root
(F2) will carry.

New files under `apps/console/src/styles/v2/`:

- **`tokens.css`** — the design tokens, but `:root { … }` → `.sh-v2 { … }`. All custom
  properties (`--bg-*`, `--border-*`, `--fg-*`, `--accent*`, `--sev-*`, `--font-*`, `--r-*`,
  `--shadow-*`) defined here, inheriting to all descendants of `.sh-v2`.
- **`base.css`** — base element styles from the design, scoped: `.sh-v2 { background; color;
  font-family; font-feature-settings; -webkit-font-smoothing; }`, `.sh-v2 *  { box-sizing }`,
  `.sh-v2 button`, `.sh-v2 code/kbd/samp`. (We do **not** touch global `html, body`.)
- **`components.css`** — the reusable class layer from `tokens.css` (`.sh-card`, `.sh-tag`,
  `.sh-btn`, `.sh-kpi`, `.sh-row`, `.sh-segmented`, `.sh-input`, `.sh-code`, `.sh-stripe`,
  `.sh-bars`, typography helpers `.sh-h1/.sh-h2/.sh-eyebrow/.sh-mono/.sh-muted/.sh-faint`),
  each prefixed-scoped under `.sh-v2` (e.g. `.sh-v2 .sh-card { … }`) so the names can never
  collide with legacy CSS.
- **`keyframes.css`** — shared animations referenced by primitives: `sh-ping`, `sh-pulse`
  (and the shell's later additions live in F2). Keyframes are global by nature; names are
  `sh-`-prefixed to avoid collisions.

Imported once in `main.tsx`, **after** `styles.css`, so cascade order is deterministic:

```ts
import "./styles.css";
import "./styles/v2/index.css"; // @imports tokens, base, components, keyframes
```

Because every v2 rule is selector-scoped to `.sh-v2` (higher specificity than legacy bare
class/element rules) and only rendered inside the v2 wrapper, the two systems are isolated in
both directions: legacy screens never see v2 vars, v2 components never inherit legacy rules.

### 2. Self-hosted fonts

Add **`@fontsource/geist-sans`** (weights 400/500/600/700) and
**`@fontsource/jetbrains-mono`** (400/500/600) as dependencies. Import the needed weight CSS
in `styles/v2/index.css`. `@fontsource` ships woff2 + `@font-face` and is the standard
Vite-friendly self-host path; the files are emitted to the build and served from `/console/`.
The `--font-sans` / `--font-mono` stacks already name `"Geist"` / `"JetBrains Mono"` first
with system fallbacks, so partial loads degrade gracefully.

> Fallback if `@fontsource/geist-sans` is unavailable on the registry at install time: vendor
> the woff2 files into `apps/console/src/styles/v2/fonts/` and hand-write the `@font-face`
> blocks. Decided at plan time after checking the registry.

### 3. Primitive library

Port the design's primitives to typed React (`.tsx`) under
**`apps/console/src/components/ui/v2/`**. The design uses a global `Icon`/`window` registry and
inline styles; we keep inline styles where the design uses them (fidelity), convert to typed
props, and export named components. No `Object.assign(window, …)`.

From `app-shared.jsx`:

- **`Icon`** — `{ name: IconName; size?; stroke?; style? }`. Port the full path table; `IconName`
  is a union of the keys. Single source for all glyphs.
- **`StatusDot`** — `{ status: Status; size?; pulse? }`. `Status = "ok" | "warning" | "critical" | "idle"`.
- **`Sparkline`** — `{ data: number[]; color?; height?; fill? }`. Hand-rolled SVG; keep the exact
  viewBox math, 0.92 vertical inset, `vectorEffect="non-scaling-stroke"`, gradient fill.
  (Replace the design's `Math.random()` gradient id with React `useId()` for SSR/test stability.)
- **`Bars`** — `{ data: number[]; color?; height?; highlight?: number | null }`.
- **`MicroSpark`** — `{ data: number[]; color?; width?; height? }` (tight health-rail spark).
- **`status` helpers** — export `STATUS` map and `sev(status)` from a `status.ts` module.

From `app-screens-common.jsx`:

- **`PageHead`** `{ title; sub?; actions? }`
- **`Segmented`** `{ options: string[]; value; onChange? }`
- **`SummaryStat`** `{ label; value; delta?; tone?; mono? }`
- **`Divider`**
- **`StatusPill`** `{ status: "open"|"investigating"|"resolved"|"ignored" }`
- **`PriorityPill`** `{ p: "P1"|"P2"|"P3"|"P4" }`
- **`BigKpi`** `{ label; value; sub?; delta?; deltaDir?; spark?; color? }`
- **`Legend`** `{ color; label }`
- **`Kv`** `{ k; v; mono?; tone? }`
- **`SecretField`** `{ value; masked? }` — reveal toggle, mask via `replace(/.(?=.{4})/g, "•")`,
  copy with 1.4s feedback. Wire copy to the real clipboard (the design stubs it) — reuse the
  existing `CopyButton` clipboard logic so behavior matches the legacy primitive.
- **`ConfirmButton`** `{ label; confirmLabel?; icon?; kind?; onConfirm }` — inline two-step arm
  with 2.6s auto-disarm.
- **`EmptyHint`** `{ icon?; title; sub?; cta? }`

Two more primitives the screens lean on (extracted now so screens don't re-roll them):

- **`Card`** — thin wrapper emitting `.sh-card` / `.sh-card__head` / `.sh-card__body` structure
  (`{ title?; actions?; flush?; children; className?; style? }`). Optional; screens may also use
  the raw classes. Provided for the common header+body case.
- **`Toast` / `ToastStack` types** — the toast **visual** primitive only (markup + `data-tone`).
  The toast *controller* (queue, auto-dismiss, context/provider) belongs to **F2**; F1 ships the
  presentational component and the `Toast` type so F2 wires state to it.

### 4. Module layout

```
apps/console/src/
  styles/v2/
    index.css          # @import the four below + @fontsource css
    tokens.css         # .sh-v2 { --vars }
    base.css           # .sh-v2 base element styles
    components.css     # .sh-v2 .sh-* class layer
    keyframes.css      # @keyframes sh-ping / sh-pulse
  components/ui/v2/
    icon.tsx           # Icon + IconName
    status.ts          # STATUS, sev, Status type
    status-dot.tsx
    charts.tsx         # Sparkline, Bars, MicroSpark
    primitives.tsx     # PageHead, Segmented, SummaryStat, Divider, Legend, Kv, Card
    pills.tsx          # StatusPill, PriorityPill, BigKpi
    secret-field.tsx
    confirm-button.tsx
    empty-hint.tsx
    toast.tsx          # presentational Toast + Toast type
    index.ts           # barrel re-export
```

(Exact file grouping is a plan-time detail; the boundary that matters: one module per concern,
each independently testable, all re-exported from `index.ts`.)

## Testing

TDD per primitive (the project already uses Vitest + React Testing Library + jsdom, tests
colocated). For each primitive, a `*.test.tsx` asserting the contract, not the pixels:

- **Icon** — renders an `<svg>` for a known `name`; unknown name renders nothing/empty safely.
- **StatusDot** — applies the `sev(status).color`; renders the ping layer only when
  `pulse && status !== "ok"`.
- **Sparkline / Bars / MicroSpark** — given data, emit a `<path>`/bars; `highlight` index gets
  the critical color; empty/short arrays don't throw (divide-by-zero guards hold).
- **SecretField** — masks by default, reveals on toggle, copies value to clipboard, shows
  "Copiado" then reverts.
- **ConfirmButton** — first click arms (shows `confirmLabel`), second click fires `onConfirm`;
  auto-disarms after timeout (fake timers).
- **StatusPill / PriorityPill / BigKpi / Segmented** — render the right label/aria-pressed.

A lightweight **`styles/v2` smoke test** (mirroring the existing `styles.test.ts`) asserting the
v2 CSS defines `.sh-v2` token vars and that no rule leaks an unscoped `:root`/`html`/`body`
selector (guards the coexistence guarantee).

## Verification

```sh
pnpm --filter @sigmon/console test
pnpm --filter @sigmon/console build
pnpm --filter @sigmon/console lint   # tsc --noEmit
```

Plus a manual visual check: render the primitives on a scratch `.sh-v2` page and eyeball
against the design `tokens.css`/`app-shared.jsx` (a Storybook-less gallery route can be a
throwaway during dev; not shipped).

## Out of scope (F1)

- The shell, nav rail, top bar, Health Rail, page transitions, and the toast **controller** → F2.
- Any screen content → S1–S10.
- Touching or restyling legacy `styles.css` / existing screens.
- A light theme variant (dropped by decision).

## Risks / notes

- **oklch support**: all target browsers for a modern self-hosted admin console support
  `oklch()`; no fallback layer planned. Note if that assumption is wrong.
- **Specificity**: scoping via `.sh-v2 .sh-card` raises specificity above legacy bare-class
  rules — intended, keeps isolation one-directional. Watch for any v2 component used (later)
  outside a `.sh-v2` root: it must always render inside the wrapper.
- **Chart fidelity is a feature**: do not "tidy" the SVG math. Stroke widths, the 0.92 inset,
  `non-scaling-stroke`, gradient opacities, and `tabular-nums` are deliberate.
