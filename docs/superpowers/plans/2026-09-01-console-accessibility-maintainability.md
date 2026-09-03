# Console Accessibility, Responsive Scope, and Style Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make audited console interactions WCAG-AA readable and keyboard-operable, establish an honest mobile boundary, and extract the repeated visual rules touched by those fixes.

**Architecture:** Correct semantic tokens and motion centrally, fix interaction semantics in their owning React components, introduce a route-aware narrow-screen boundary, then extract only repeated audited styles into shared classes with regression metrics.

**Tech Stack:** React 19, TypeScript, CSS custom properties, Vitest/jsdom, Testing Library, Vite, browser viewport verification.

**Spec:** `docs/superpowers/specs/2026-09-01-console-accessibility-maintainability-design.md`

## Global Constraints

- Preserve the current dark observability design and `/console/status` mobile surface.
- Normal text tokens must measure at least 4.5:1 on every used background.
- Core search/trace actions work with keyboard and show focus.
- Audited hit areas are at least 44 by 44 CSS pixels without enlarging glyphs unnecessarily.
- Below 900px, dense investigation routes show a boundary page rather than clipped UI.
- Fake actions are removed; conditionally unavailable actions are visibly disabled with a reason.
- Static inline styles in audited surfaces fall at least 25 percent; data-driven geometry may remain inline.

---

### Task 1: Contrast tokens and reduced motion

**Files:**
- Modify: `apps/console/src/styles/v2/tokens.css`
- Modify: `apps/console/src/styles/v2/components.css`
- Modify: `apps/console/src/styles/v2/shell.css`
- Modify: `apps/console/src/styles/v2/keyframes.css`
- Modify: `apps/console/src/styles/v2/styles-v2.test.ts`
- Modify: `apps/console/src/styles/v2/shell-css.test.ts`

**Interfaces:**
- Produces: AA-safe `--fg-secondary`, `--fg-muted`, `--fg-faint`, `--focus-ring`, and scoped reduced-motion override.
- Consumes: existing background/surface tokens and animation names.

- [ ] **Step 1: Write failing contrast/motion contract tests**

```ts
it.each(["--fg-secondary", "--fg-muted", "--fg-faint"])("keeps %s at 4.5:1 on audited surfaces", (token) => {
  for (const background of auditedBackgrounds(token)) {
    expect(contrast(resolveToken(token), resolveToken(background))).toBeGreaterThanOrEqual(4.5);
  }
});

it("disables every named v2 animation for reduced motion", () => {
  expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  for (const name of ["pgFade", "pgFwd", "pgBack", "menuIn", "sh-pulse", "toastIn"]) expect(reducedBlock).toContain(name);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/console/src/styles/v2/styles-v2.test.ts apps/console/src/styles/v2/shell-css.test.ts`

Expected: one or more contrast ratios and named animations fail.

- [ ] **Step 3: Correct semantic tokens and motion**

Adjust OKLCH lightness/chroma only through `tokens.css` until the test-calculated ratios pass. Add `--focus-ring` with 3:1 non-text contrast. In `@media (prefers-reduced-motion: reduce)`, set audited animation names to `none`, transition duration to `0.01ms`, and final accordion/menu/toast states explicitly.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm vitest run apps/console/src/styles/v2/styles-v2.test.ts apps/console/src/styles/v2/shell-css.test.ts`

```bash
git add apps/console/src/styles/v2/tokens.css apps/console/src/styles/v2/components.css apps/console/src/styles/v2/shell.css apps/console/src/styles/v2/keyframes.css apps/console/src/styles/v2/styles-v2.test.ts apps/console/src/styles/v2/shell-css.test.ts
git commit -m "fix(console): meet contrast and reduced-motion contracts"
```

### Task 2: Keyboard semantics, focus, and hit areas

**Files:**
- Modify: `apps/console/src/v2/shell/TopBar.tsx`
- Modify: `apps/console/src/v2/shell/TopBar.test.tsx`
- Modify: `apps/console/src/v2/screens/TracesScreen.tsx`
- Modify: `apps/console/src/v2/screens/TracesScreen.test.tsx`
- Modify: `apps/console/src/components/ui/v2/status-dot.tsx`
- Modify: `apps/console/src/components/ui/v2/status-dot.test.tsx`
- Modify: `apps/console/src/styles/v2/shell.css`

**Interfaces:**
- Produces: native top-bar search button, keyboard-selectable trace rows, shared `.sh-hit-target` and focus-visible ring.
- Consumes: existing search/open/select/toggle callbacks.

- [ ] **Step 1: Write failing interaction tests**

```ts
it("opens search from keyboard", async () => {
  render(<TopBar {...props} />);
  const search = screen.getByRole("button", { name: /search/i });
  search.focus();
  await user.keyboard("{Enter}");
  expect(props.onOpenSearch).toHaveBeenCalledTimes(1);
});

it.each(["{Enter}", " "])("selects a trace row with %s", async (key) => {
  renderTraceRow();
  screen.getByRole("button", { name: /trace/i }).focus();
  await user.keyboard(key);
  expect(onSelect).toHaveBeenCalledTimes(1);
});
```

Add assertions that nested expand does not select the row, visible focus class applies, and audited control CSS has `min-width/min-height: 44px`.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/console/src/v2/shell/TopBar.test.tsx apps/console/src/v2/screens/TracesScreen.test.tsx apps/console/src/components/ui/v2/status-dot.test.tsx apps/console/src/styles/v2/shell-css.test.ts`

Expected: search/row roles or keyboard activation are absent and small targets fail.

- [ ] **Step 3: Implement semantics without nested native buttons**

Make search a native `<button type="button">`. Keep the trace row container as `div role="button" tabIndex={0}` because it contains a real expand button; handle Enter/Space with `preventDefault`, and stop propagation from expand. Use `.sh-hit-target` pseudo/content layout to provide 44px boxes while keeping icons compact. Apply `:focus-visible` through the shared ring.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm vitest run apps/console/src/v2/shell/TopBar.test.tsx apps/console/src/v2/screens/TracesScreen.test.tsx apps/console/src/components/ui/v2/status-dot.test.tsx apps/console/src/styles/v2/shell-css.test.ts`

```bash
git add apps/console/src/v2/shell/TopBar.tsx apps/console/src/v2/shell/TopBar.test.tsx apps/console/src/v2/screens/TracesScreen.tsx apps/console/src/v2/screens/TracesScreen.test.tsx apps/console/src/components/ui/v2/status-dot.tsx apps/console/src/components/ui/v2/status-dot.test.tsx apps/console/src/styles/v2/shell.css
git commit -m "fix(console): support keyboard and accessible targets"
```

### Task 3: Responsive route boundary and honest affordances

**Files:**
- Create: `apps/console/src/v2/NarrowConsoleBoundary.tsx`
- Create: `apps/console/src/v2/NarrowConsoleBoundary.test.tsx`
- Modify: `apps/console/src/v2/ConsoleShellV2.tsx`
- Modify: `apps/console/src/v2/ConsoleShellV2.test.tsx`
- Modify: `apps/console/src/v2/MobileStatusView.tsx`
- Modify: `apps/console/src/v2/screens/TracesScreen.tsx`
- Modify: `apps/console/src/v2/screens/TenantScreen.tsx`
- Modify: `apps/console/src/v2/screens/LlmScreen.tsx`
- Modify: corresponding screen tests
- Modify: `apps/console/src/styles/v2/shell.css`

**Interfaces:**
- Produces: `useNarrowConsole(maxWidth = 899): boolean`; route-aware boundary with `/console/status` link.
- Consumes: current console router/registry and status route.

- [ ] **Step 1: Write failing viewport and affordance tests**

```ts
it("shows the status handoff for a dense route below 900px", () => {
  setViewportWidth(899);
  renderConsole("/console/traces");
  expect(screen.getByRole("link", { name: /open mobile status/i })).toHaveAttribute("href", "/console/status");
  expect(screen.queryByTestId("traces-screen")).not.toBeInTheDocument();
});
```

Prove 900px renders the investigation route, 390px status remains usable, and the unimplemented trace incident-link button/toast-only actions are absent.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/console/src/v2/NarrowConsoleBoundary.test.tsx apps/console/src/v2/ConsoleShellV2.test.tsx apps/console/src/v2/screens/TracesScreen.test.tsx apps/console/src/v2/screens/TenantScreen.test.tsx apps/console/src/v2/screens/LlmScreen.test.tsx`

Expected: dense routes render at 899px and fake actions remain visible.

- [ ] **Step 3: Implement route-aware boundary**

Use `matchMedia("(max-width: 899px)")` with a change listener. Exempt auth and `/console/status`; all other v2 screens render `NarrowConsoleBoundary`. Add `minmax(0, ...)`, scroll containers, or stacking for audited 900–1279px grids. Remove the trace incident-link button and other toast-only unavailable controls; use disabled state only when a real condition can later become satisfied in the current screen.

- [ ] **Step 4: Verify GREEN and commit**

Run the same focused test command; expected PASS at 390/899/900/1280 fixtures.

```bash
git add apps/console/src/v2/NarrowConsoleBoundary.tsx apps/console/src/v2/NarrowConsoleBoundary.test.tsx apps/console/src/v2/ConsoleShellV2.tsx apps/console/src/v2/ConsoleShellV2.test.tsx apps/console/src/v2/MobileStatusView.tsx apps/console/src/v2/screens/TracesScreen.tsx apps/console/src/v2/screens/TracesScreen.test.tsx apps/console/src/v2/screens/TenantScreen.tsx apps/console/src/v2/screens/TenantScreen.test.tsx apps/console/src/v2/screens/LlmScreen.tsx apps/console/src/v2/screens/LlmScreen.test.tsx apps/console/src/styles/v2/shell.css
git commit -m "fix(console): define responsive investigation boundary"
```

### Task 4: Extract audited style primitives and add guards

**Files:**
- Create: `apps/console/src/styles/v2/primitives.css`
- Modify: `apps/console/src/styles/v2/index.css`
- Modify: `apps/console/src/v2/screens/OverviewScreen.tsx`
- Modify: `apps/console/src/v2/screens/TracesScreen.tsx`
- Modify: `apps/console/src/v2/screens/TenantScreen.tsx`
- Modify: `apps/console/src/v2/screens/LlmScreen.tsx`
- Modify: `apps/console/src/v2/screens/analytics/DashboardsTab.tsx`
- Create: `apps/console/src/styles/v2/style-contract.test.ts`

**Interfaces:**
- Produces: `.sh-interactive-row`, `.sh-focus-ring`, `.sh-investigation-grid`, `.sh-icon-target`, semantic text/severity classes.
- Consumes: behavior from Tasks 1–3; data-driven geometry remains inline.

- [ ] **Step 1: Write failing source guards**

```ts
it("contains no direct color literals outside approved token/visualization files", () => {
  expect(scanDirectColors(auditedFiles)).toEqual([]);
});

it("reduces static inline style objects in audited surfaces by 25 percent", () => {
  expect(countStaticInlineStyles(auditedFiles)).toBeLessThanOrEqual(Math.floor(BASELINE * 0.75));
});
```

Compute and commit `BASELINE` from the files before editing; the scanner ignores JSX values that reference runtime variables and approved chart coordinate files.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/console/src/styles/v2/style-contract.test.ts`

Expected: direct colors and baseline threshold fail.

- [ ] **Step 3: Extract only repeated audited rules**

Move static color/layout/typography objects to named classes in `primitives.css`; replace direct colors with tokens. Do not migrate unrelated screens or runtime chart widths.

- [ ] **Step 4: Verify GREEN plus component regressions**

Run: `pnpm vitest run apps/console/src/styles/v2/style-contract.test.ts apps/console/src/v2/screens/OverviewScreen.test.tsx apps/console/src/v2/screens/TracesScreen.test.tsx apps/console/src/v2/screens/TenantScreen.test.tsx apps/console/src/v2/screens/LlmScreen.test.tsx`

Expected: PASS and at least 25 percent static-inline reduction.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/styles/v2/primitives.css apps/console/src/styles/v2/index.css apps/console/src/styles/v2/style-contract.test.ts apps/console/src/v2/screens/OverviewScreen.tsx apps/console/src/v2/screens/TracesScreen.tsx apps/console/src/v2/screens/TenantScreen.tsx apps/console/src/v2/screens/LlmScreen.tsx apps/console/src/v2/screens/analytics/DashboardsTab.tsx
git commit -m "refactor(console): extract audited style primitives"
```

### Task 5: Console verification and visual evidence

**Files:**
- Modify: `.claude/docs/DECISIONS.md`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: PER-511/PER-512/PER-513 evidence and the responsive support decision.

- [ ] **Step 1: Record the responsive support boundary**

Document `/console/status` below 900px and dense investigation support at 900px and above, plus the rule for removing misleading affordances.

- [ ] **Step 2: Run full console tests and build**

Run: `pnpm --filter @sigmon/console test`

Run: `pnpm --filter @sigmon/console build`

Expected: all tests PASS and build exits 0.

- [ ] **Step 3: Verify in browser**

Start the console with the repository dev command. Inspect representative Overview, Traces, Tenant, LLM, and Status routes at 390, 768, 900, and 1280px; verify keyboard focus/activation and reduced-motion emulation. Save screenshots under the task artifact directory, not the repository.

- [ ] **Step 4: Commit decision record**

```bash
git add .claude/docs/DECISIONS.md
git commit -m "docs(console): record responsive support boundary"
```
