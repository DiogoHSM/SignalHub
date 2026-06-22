# Console v2 — F2 App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v2 three-column shell (nav rail · top bar · cross-project Health Rail) as a flag-gated app frame that hosts both finished v2 screens (dark) and not-yet-migrated legacy screens (light), so the v2 console is fully navigable end-to-end while screens migrate one at a time.

**Architecture:** `App.tsx` picks `ConsoleShellV2` (new) vs legacy `ConsoleShell` from a runtime flag (default-off). `ConsoleShellV2` renders inside `.sh-v2` (F1 tokens) and routes each nav section through a **screen registry**: `v2` entries render directly (dark), `legacy` entries render inside a `.console-legacy-island` that re-establishes the light token values. Health Rail consumes B1's `/query/fleet` with a graceful fallback. Shared project/env loading is extracted into a hook used by both shells.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + @testing-library/react + jsdom. Builds on F1 (`src/styles/v2/`, `src/components/ui/v2/`).

## Global Constraints

- Package `@sigmon/console`; commands via `pnpm --filter @sigmon/console <script>`.
- **Default-off:** the v2 shell must NOT change the console for existing users until the flag default is flipped. `App.tsx` default resolves to legacy `ConsoleShell`. Legacy `ConsoleShell` and its 39 tests must keep passing unchanged.
- **Scope all v2 CSS under `.sh-v2`** (same rule as F1). The shell-layout CSS is ported from `.claude/design-v2/shell.css` — prefix every selector with `.sh-v2 ` (e.g. `.app` → `.sh-v2 .app`, `.hr-card[data-status="critical"]` → `.sh-v2 .hr-card[data-status="critical"]`). Do NOT emit the prototype's bare `html, body, #root` rule — adapt it to the shell root (see Task 2).
- **Legacy island** is the only sanctioned touch to `styles.css`: extend the legacy `:root` token selector to `:root, .console-legacy-island` (no value duplication) and add the island reset rule. Nothing else in `styles.css` changes.
- Fidelity: port shell/rail/switcher/toast markup + CSS verbatim from `.claude/design-v2/` (`app-shell.jsx`, `app-health-rail.jsx`, `shell.css`); keep transitions, sizes, animations exactly. Use F1 primitives (`Icon`, `StatusDot`, `MicroSpark`, `ToastView`, `sev`, types) — never re-implement them.
- Reuse, don't fork: the existing command palette (⌘K) and the project/env data layer. The ⌘K affordance in the v2 top bar opens the existing palette.
- Design source files cited by path are committed under `.claude/design-v2/`. They use a React-18 `window`/global style; port to React 19 ESM with typed props, dropping `Object.assign(window, …)`.
- Tests colocate (`*.test.tsx`), `afterEach(cleanup)`, follow the existing `ConsoleShell.test.tsx` / `ui/v2` patterns.

## File Structure

```
apps/console/src/
  App.tsx                         # MODIFY: choose shell by flag
  v2/
    flag.ts                       # resolveV2ShellFlag()
    ConsoleShellV2.tsx            # the v2 frame: state, persistence, transitions, assembly
    useConsoleProjects.ts         # shared project/env loader (extracted from ConsoleShell)
    useToasts.ts                  # toast queue controller
    useFleet.ts                   # GET /query/fleet + graceful fallback
    nav.ts                        # NAV / NAV_BOTTOM section defs + NavSection type
    screens/registry.tsx          # NavSection -> { kind: "v2"|"legacy", render }
    shell/
      NavRail.tsx
      TopBar.tsx                  # + ProjectSwitcher + Breadcrumb (one cohesive top bar module)
      HealthRail.tsx              # + FleetBar + InfraDots + ProjectCard
      ToastStack.tsx              # uses ui/v2 ToastView + useToasts
  styles/v2/
    shell.css                     # NEW: ported shell layout, scoped under .sh-v2
    index.css                     # MODIFY: @import "./shell.css"
  styles.css                      # MODIFY (minimal): legacy-island token bridge only
  api/client.ts                   # MODIFY: add fetchFleet() (+ types) for /query/fleet
```

---

### Task 1: v2 shell flag + App switch

**Files:**
- Create: `apps/console/src/v2/flag.ts`
- Create: `apps/console/src/v2/flag.test.ts`
- Modify: `apps/console/src/App.tsx`
- Test: `apps/console/src/App.test.tsx` (add cases; do not break existing)

**Interfaces:**
- Produces: `resolveV2ShellFlag(search?: string): boolean` — `?v2=1`→true (persist `localStorage["sh_v2_shell"]="1"`), `?v2=0`→false (persist `"0"`), else stored value, else `false`.

- [ ] **Step 1: Write the failing test** — `flag.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { resolveV2ShellFlag } from "./flag";

afterEach(() => localStorage.clear());

describe("resolveV2ShellFlag", () => {
  it("defaults to false", () => { expect(resolveV2ShellFlag("")).toBe(false); });
  it("?v2=1 opts in and persists", () => {
    expect(resolveV2ShellFlag("?v2=1")).toBe(true);
    expect(localStorage.getItem("sh_v2_shell")).toBe("1");
    expect(resolveV2ShellFlag("")).toBe(true); // sticky
  });
  it("?v2=0 opts out and persists", () => {
    localStorage.setItem("sh_v2_shell", "1");
    expect(resolveV2ShellFlag("?v2=0")).toBe(false);
    expect(localStorage.getItem("sh_v2_shell")).toBe("0");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @sigmon/console test -- v2/flag` → FAIL (no module).

- [ ] **Step 3: Implement `flag.ts`:**

```ts
const KEY = "sh_v2_shell";
export function resolveV2ShellFlag(search: string = window.location.search): boolean {
  const params = new URLSearchParams(search);
  const q = params.get("v2");
  if (q === "1" || q === "0") {
    localStorage.setItem(KEY, q);
    return q === "1";
  }
  return localStorage.getItem(KEY) === "1";
}
```

- [ ] **Step 4: Wire `App.tsx`** — read the current `App.tsx`, and switch the rendered shell:

```tsx
import { resolveV2ShellFlag } from "./v2/flag";
import { ConsoleShellV2 } from "./v2/ConsoleShellV2";
// inside App(): keep all existing providers/gates; choose the shell:
const useV2 = resolveV2ShellFlag();
return useV2 ? <ConsoleShellV2 /> : <ConsoleShell />;
```

(Until Task 9 lands `ConsoleShellV2`, export a minimal placeholder from `v2/ConsoleShellV2.tsx` — `export function ConsoleShellV2() { return <div className="sh-v2" />; }` — so the app compiles. Task 9 replaces it.)

- [ ] **Step 5: Add `App.test.tsx` cases** — flag on renders `ConsoleShellV2`, off renders `ConsoleShell`. Mock `resolveV2ShellFlag` or set `localStorage`/`window.location.search` via the test env. Assert a distinguishing element of each shell.

- [ ] **Step 6: Run tests** — `pnpm --filter @sigmon/console test -- v2/flag App` → PASS; existing App tests still green.

- [ ] **Step 7: Commit** — `git add apps/console/src/v2/flag.ts apps/console/src/v2/flag.test.ts apps/console/src/v2/ConsoleShellV2.tsx apps/console/src/App.tsx apps/console/src/App.test.tsx && git commit -m "feat(console-v2): v2 shell flag + App switch (PER-343)"`

---

### Task 2: shell CSS port (scoped under .sh-v2)

**Files:**
- Create: `apps/console/src/styles/v2/shell.css`
- Modify: `apps/console/src/styles/v2/index.css` (add `@import "./shell.css";`)
- Test: `apps/console/src/styles/v2/shell-css.test.ts`

**Interfaces:** Produces the scoped shell classes (`.app`, `.nv*`, `.app-main`, `.app-workspace`, `.page`, `.tb*`, `.sw-*`, `.bc*`, `.hr*`, `.inv-tabs`, `.toast*`, misc) + keyframes `pgFade/pgFwd/pgBack/menuIn/toastIn` consumed by Tasks 5–9.

- [ ] **Step 1: Write the failing test** — `shell-css.test.ts` (mirror F1's `styles-v2.test.ts`):

```ts
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
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @sigmon/console test -- shell-css` → FAIL.

- [ ] **Step 3: Create `shell.css`** — copy every rule from `.claude/design-v2/shell.css` and prefix each selector with `.sh-v2 `. Specifics:
  - Drop the prototype's `html, body { … }` and `#root { … }` rules. Replace with `.sh-v2 .app { height: 100%; }` (the grid already sets `height: 100vh` — change that to `height: 100%` so it fills the console mount, not the viewport). Keep `grid-template-columns`, the rail transition, and `data-rail` rule.
  - `@keyframes` blocks (`pgFade`, `pgFwd`, `pgBack`, `menuIn`, `toastIn`, `sh-ping`, `sh-pulse`) stay top-level (keyframes can't be scoped); `sh-ping`/`sh-pulse` already ship from F1 `keyframes.css` — to avoid duplicate definitions, include only `pgFade/pgFwd/pgBack/menuIn/toastIn` here and delete the `sh-ping`/`sh-pulse` blocks from the port.
  - The `@media (prefers-reduced-motion)` rule's selectors get `.sh-v2 ` prefixes on `.page[data-anim=...]`.
  - The `::-webkit-scrollbar` rules: prefix the host selectors (`.sh-v2 .hr-list::-webkit-scrollbar`, etc.).

- [ ] **Step 4: Add `@import "./shell.css";`** to `index.css` (after `components.css`, before/after `keyframes.css` is fine).

- [ ] **Step 5: Run test + build** — `pnpm --filter @sigmon/console test -- shell-css` → PASS; `pnpm --filter @sigmon/console build` → clean.

- [ ] **Step 6: Commit** — `git commit -m "feat(console-v2): scoped shell layout CSS (PER-343)"`

---

### Task 3: legacy island token bridge + screen registry

**Files:**
- Modify: `apps/console/src/styles.css` (legacy token selector + island reset — minimal)
- Create: `apps/console/src/v2/nav.ts`
- Create: `apps/console/src/v2/screens/registry.tsx`
- Create: `apps/console/src/v2/screens/LegacyIsland.tsx`
- Test: `apps/console/src/v2/screens/registry.test.tsx`

**Interfaces:**
- `nav.ts`: `type NavSection = "overview"|"investigate"|"incidents"|"llm"|"traces"|"alerts"|"system"|"settings"`; `NAV`/`NAV_BOTTOM` arrays `{ id: NavSection; icon: IconName; label: string; badge?: boolean }`.
- `LegacyIsland`: `({ children }) => <div className="console-legacy-island">{children}</div>`.
- `registry.tsx`: `type ScreenEntry = { kind: "v2" | "legacy"; render: (ctx: ScreenCtx) => ReactNode }`; `SCREENS: Record<NavSection, ScreenEntry>`; `renderSection(section, ctx)` wraps `legacy` entries in `<LegacyIsland>`. At F2 every entry is `legacy` (Task 10 fills real legacy components; here they may be placeholders returning a labeled stub).

- [ ] **Step 1: Write the failing test** — `registry.test.tsx`:

```tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderSection, SCREENS } from "./registry";

afterEach(cleanup);

describe("screen registry", () => {
  it("has an entry for every nav section", () => {
    for (const s of ["overview","investigate","incidents","llm","traces","alerts","system","settings"] as const)
      expect(SCREENS[s]).toBeDefined();
  });
  it("wraps legacy entries in the legacy island", () => {
    const { container } = render(<>{renderSection("overview", {} as any)}</>);
    expect(container.querySelector(".console-legacy-island")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @sigmon/console test -- v2/screens/registry` → FAIL.

- [ ] **Step 3: Legacy island CSS in `styles.css`** — find the legacy `:root {` token block and change its selector to `:root,\n.console-legacy-island {` (same declarations; no values duplicated). Then add once:

```css
.console-legacy-island { color-scheme: light; height: 100%; overflow: auto; }
```

Do not change any other legacy rule.

- [ ] **Step 4: Implement `nav.ts`, `LegacyIsland.tsx`, `registry.tsx`** — `nav.ts` ports the `NAV`/`NAV_BOTTOM` defs from `.claude/design-v2/app-shell.jsx` typed to `NavSection`. `registry.tsx`:

```tsx
import type { ReactNode } from "react";
import { LegacyIsland } from "./LegacyIsland";
import type { NavSection } from "../nav";

export type ScreenCtx = { /* filled in Task 10 — project, env, navigate, drill */ };
export type ScreenEntry = { kind: "v2" | "legacy"; render: (ctx: ScreenCtx) => ReactNode };

export const SCREENS: Record<NavSection, ScreenEntry> = {
  overview:    { kind: "legacy", render: () => <Stub label="Overview" /> },
  investigate: { kind: "legacy", render: () => <Stub label="Investigate" /> },
  incidents:   { kind: "legacy", render: () => <Stub label="Incidents" /> },
  llm:         { kind: "legacy", render: () => <Stub label="LLM" /> },
  traces:      { kind: "legacy", render: () => <Stub label="Traces" /> },
  alerts:      { kind: "legacy", render: () => <Stub label="Alerts" /> },
  system:      { kind: "legacy", render: () => <Stub label="System" /> },
  settings:    { kind: "legacy", render: () => <Stub label="Settings" /> },
};
function Stub({ label }: { label: string }) { return <div data-stub={label}>{label}</div>; }

export function renderSection(section: NavSection, ctx: ScreenCtx): ReactNode {
  const entry = SCREENS[section];
  const node = entry.render(ctx);
  return entry.kind === "legacy" ? <LegacyIsland>{node}</LegacyIsland> : node;
}
```

(Stubs are placeholders; Task 10 swaps in the real legacy screen components. Keeping them here lets Tasks 4–9 build and test the shell before the legacy wiring lands.)

- [ ] **Step 5: Run test + build** — `pnpm --filter @sigmon/console test -- v2/screens/registry` → PASS; build clean; **run the full suite once** to confirm the `styles.css` edit didn't break the legacy CSS contract test: `pnpm --filter @sigmon/console test` → all green.

- [ ] **Step 6: Commit** — `git commit -m "feat(console-v2): legacy-island token bridge + screen registry (PER-343)"`

---

### Task 4: shared project/env loader (`useConsoleProjects`)

**Files:**
- Create: `apps/console/src/v2/useConsoleProjects.ts`
- Modify: `apps/console/src/components/ConsoleShell.tsx` (consume the hook for its project/env load — minimal extraction)
- Test: `apps/console/src/v2/useConsoleProjects.test.tsx`

**Interfaces:** Produces `useConsoleProjects(): { projects, environments, activeProject, activeEnvironment, selectProject(id), selectEnvironment(name), isLoading }` backed by the existing `api/client` project/environment calls.

- [ ] **Step 1: Read** `ConsoleShell.tsx` to identify the project/environment loading (`listProjects`, `listEnvironments`, active selection state). Extract ONLY that into the hook.
- [ ] **Step 2: Write the failing test** — render a probe component using the hook with `api/client` mocked (vi.mock) to return two projects + envs; assert `projects.length===2`, `activeProject` defaults to the first, `selectProject` switches and loads its envs. (Mirror how `ConsoleShell.test.tsx` mocks the client.)
- [ ] **Step 3: Run to verify it fails.**
- [ ] **Step 4: Implement the hook** — move the loading/state out of ConsoleShell; have ConsoleShell call the hook so behavior is unchanged.
- [ ] **Step 5: Run tests** — the new hook test PASSES **and the full `ConsoleShell.test.tsx` (39 tests) still passes** (`pnpm --filter @sigmon/console test -- ConsoleShell useConsoleProjects`). If extraction proves too entangled, STOP and report DONE_WITH_CONCERNS: ship a v2-local loader instead and leave ConsoleShell untouched (note the duplication).
- [ ] **Step 6: Commit** — `git commit -m "feat(console-v2): shared useConsoleProjects loader (PER-343)"`

---

### Task 5: toast controller (`useToasts`) + `ToastStack`

**Files:**
- Create: `apps/console/src/v2/useToasts.ts`
- Create: `apps/console/src/v2/shell/ToastStack.tsx`
- Test: `apps/console/src/v2/useToasts.test.tsx`, `apps/console/src/v2/shell/ToastStack.test.tsx`

**Interfaces:**
- `useToasts(): { toasts: Toast[]; toast(t: Omit<Toast,"id">): void; dismiss(id: number): void }` — auto-dismiss after 3400ms; `Toast` type from `ui/v2`.
- `ToastStack({ toasts, onDismiss })` — `.toast-stack` container rendering `ToastView`s (markup from `.claude/design-v2/app-shell.jsx` `ToastStack`).

- [ ] **Step 1: Write failing tests** — `useToasts`: `toast()` enqueues with an incrementing id; auto-removes after 3400ms (fake timers); `dismiss(id)` removes immediately. `ToastStack`: renders one `ToastView` per toast; clicking dismiss calls `onDismiss(id)`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** — `useToasts` with a ref counter + `setTimeout`/cleanup (mirror F1 SecretField's mounted-safe timer pattern; clear timers on unmount). `ToastStack` uses `ui/v2`'s `ToastView`.
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(console-v2): toast controller + ToastStack (PER-343)"`

---

### Task 6: NavRail

**Files:** Create `apps/console/src/v2/shell/NavRail.tsx` + `NavRail.test.tsx`.

**Interfaces:** `NavRail({ active: NavSection; onNavigate(s): void; fleetCritical: number })` — ported from `.claude/design-v2/app-shell.jsx` `NavRail`, using `nav.ts` defs + `ui/v2` `Icon`. Critical dot on `incidents` when `fleetCritical > 0`.

- [ ] **Step 1: Failing test** — renders an item per `NAV`+`NAV_BOTTOM`; the active item has `is-active`; clicking calls `onNavigate(id)`; the incidents dot shows only when `fleetCritical>0`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — verbatim port (logo SVG, items, tooltips), typed.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(console-v2): NavRail (PER-343)"`

---

### Task 7: TopBar (+ ProjectSwitcher + Breadcrumb)

**Files:** Create `apps/console/src/v2/shell/TopBar.tsx` + `TopBar.test.tsx`.

**Interfaces:** `TopBar({ projects, project, environments, env, onSelectProject, onSelectEnv, crumb, railCollapsed, onToggleRail, onRefresh, onOpenSearch })`. Internal `ProjectSwitcher` (pill dropdowns over real `projects`/`environments`) + `Breadcrumb` (from `crumb` items). Ported from `.claude/design-v2/app-shell.jsx`; the ⌘K search affordance calls `onOpenSearch` (wired to the existing command palette in Task 9). Project/env status dots use `StatusDot` with each project's/env's status (from the fleet/loader data; fall back to `"idle"` if unknown).

- [ ] **Step 1: Failing test** — renders the active project + env pills; clicking the project pill opens the menu listing all projects; selecting calls `onSelectProject(id)`; breadcrumb renders `crumb` labels; clicking the search affordance calls `onOpenSearch`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — port `ProjectSwitcher`, `Breadcrumb`, `TopBar`; replace the design's mock `PROJECTS` with the passed-in `projects`/`environments`; outside-click closes the menu (port the effect).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(console-v2): TopBar + project/env switcher + breadcrumb (PER-343)"`

---

### Task 8: HealthRail + `useFleet` (with fallback)

**Files:**
- Create: `apps/console/src/v2/useFleet.ts`
- Create: `apps/console/src/v2/shell/HealthRail.tsx` (+ FleetBar, InfraDots, ProjectCard)
- Modify: `apps/console/src/api/client.ts` (add `fetchFleet()` + types)
- Test: `apps/console/src/v2/useFleet.test.tsx`, `apps/console/src/v2/shell/HealthRail.test.tsx`

**Interfaces:**
- `api/client.ts`: `fetchFleet(): Promise<FleetResponse>` calling `GET /query/fleet`; export `FleetProject`/`FleetRollup` types matching the B1 spec (`docs/superpowers/specs/2026-06-21-console-v2-b1-fleet-rollup-design.md` — read it for the exact shape).
- `useFleet(): { projects: FleetProject[]; rollup: FleetRollup; status: "ok"|"fallback"; lastUpdated: number }` — fetches `/query/fleet`; on error OR until the endpoint exists, returns a **degraded** rollup built from a passed-in project list (status `"idle"`, zeroed metrics, `errorTrend: []`) with `status: "fallback"`. `lastUpdated` ticks each second.
- `HealthRail({ collapsed, onToggleCollapse, selectedProjectId, onSelectProject, onOpenEnv, expandedIds, onToggleExpand, fleet })` — ported from `.claude/design-v2/app-health-rail.jsx`, but driven by `fleet` (from `useFleet`) instead of the mock `fleetRollup()`/`PROJECTS`. Uses `ui/v2` `MicroSpark`, `StatusDot`, `Icon`, `sev`.

- [ ] **Step 1: Failing tests** — `useFleet`: with `fetchFleet` mocked to reject, returns `status:"fallback"` and a project card per the seed list; with it resolved, returns `status:"ok"` and the fetched projects. `HealthRail`: renders the rollup card + a `ProjectCard` per project; expand toggles the env accordion (`aria-expanded`); collapsed mode renders the compact list. Infra dots render from the (instance-wide) `infra` object.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — add `fetchFleet` + types to `api/client.ts` (follow existing client patterns); implement `useFleet` with fetch + fallback + 1s ticker; port HealthRail/FleetBar/InfraDots/ProjectCard driven by props. (Env accordion content can render from a lazily-fetched per-project envs call per B1 — for F2, wire `onOpenEnv` to navigate/select; lazy env fetch can be a thin follow-up noted in the issue if not trivial.)
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(console-v2): HealthRail + useFleet with fallback (PER-343)"`

---

### Task 9: ConsoleShellV2 assembly

**Files:** Replace placeholder `apps/console/src/v2/ConsoleShellV2.tsx`; Test `apps/console/src/v2/ConsoleShellV2.test.tsx`.

**Interfaces:** `ConsoleShellV2()` — the full frame. Ports the design `App` root from `SignalHub Console v2.html` (state, persistence, transitions, drill/breadcrumb) onto real data:
- State: `nav` (NavSection), `railCollapsed`, `drillStack`, `expandedIds`, `anim`/`seq`, via `useConsoleProjects` for `project`/`env`, `useToasts`, `useFleet`.
- Renders `<div className="sh-v2"><div className="app" data-rail=…><NavRail/><div className="app-main"><TopBar/><div className="app-workspace"><div className="page" key={seq} data-anim={anim}>{renderSection(nav, ctx)}</div></div></div><HealthRail/><ToastStack/></div></div>`.
- Persist `{nav, projectId, env, railCollapsed}` to `localStorage["sh_v2_state"]`; restore on mount.
- ⌘K + `onOpenSearch` open the existing command palette component (import and reuse from the legacy console; render it within the v2 frame).
- Breadcrumb derives from `nav` + `drillStack` (port the design's crumb logic).

- [ ] **Step 1: Failing test** — render `ConsoleShellV2` (mock `api/client`): asserts nav rail + top bar + health rail present; clicking a nav item changes the rendered section (the registry stub/legacy content updates) and persists `nav` to `localStorage`; toggling the rail updates `data-rail` and persists; a project switch updates the top bar + persists. Use fake timers if asserting toast/lastUpdated.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** the assembly per the design `App`, wiring the hooks + `renderSection`.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(console-v2): ConsoleShellV2 assembly (PER-343)"`

---

### Task 10: wire registry to real legacy screens

**Files:** Modify `apps/console/src/v2/screens/registry.tsx` (replace stubs with real legacy components); Test update `registry.test.tsx`.

**Interfaces:** Each `legacy` entry's `render(ctx)` returns the existing legacy screen component for that section, fed from `ctx` (project/env). Mapping (confirm against current components during implementation): overview→OverviewDashboard (or OperationsDashboard), investigate→InvestigationWorkspace(events), incidents→InvestigationWorkspace(errors)/Errors, llm→InvestigationWorkspace(llm), traces→InvestigationWorkspace(traces), alerts→AlertsPanel, system→SigmonAdminWorkspace, settings→ProjectSettingsWorkspace.

- [ ] **Step 1: Read** the legacy screen components' props (what `ctx` they need: activeProject, activeEnvironment, refreshToken, etc.).
- [ ] **Step 2: Update the test** — assert a representative section (e.g. `settings`) renders its real legacy component inside `.console-legacy-island` (query a distinguishing element of that component).
- [ ] **Step 3: Run → fail.**
- [ ] **Step 4: Implement** — define `ScreenCtx` concretely (project/env/refresh) and map each section to its legacy component with the right props; ConsoleShellV2 passes the ctx.
- [ ] **Step 5: Run → pass**, plus full suite green.
- [ ] **Step 6: Commit** — `git commit -m "feat(console-v2): mount legacy screens in the v2 shell via registry (PER-343)"`

---

### Task 11: Full F2 verification

**Files:** none.

- [ ] **Step 1:** `pnpm --filter @sigmon/console test` → all pass (new v2 + legacy ConsoleShell unchanged).
- [ ] **Step 2:** `pnpm --filter @sigmon/console lint && pnpm --filter @sigmon/console build` → clean + fonts.
- [ ] **Step 3:** `pnpm test && pnpm build` → repo-wide green (incl. branding contract).
- [ ] **Step 4: Manual** — `pnpm --filter @sigmon/console dev`, open `/?v2=1`: v2 dark shell, nav switches sections, project/env pills work, Health Rail renders (fallback until B1), legacy screens render light inside `.console-legacy-island`; `/?v2=0` → unchanged legacy console. Note findings; don't commit scratch.
- [ ] **Step 5:** `git status` clean.

---

## Notes for the implementer
- F1 primitives live in `apps/console/src/components/ui/v2/` (barrel `index.ts`) — import from there; never re-roll Icon/StatusDot/charts/ToastView.
- Design sources to port verbatim: `.claude/design-v2/app-shell.jsx`, `app-health-rail.jsx`, `shell.css` (the committed mirror is authoritative for markup/CSS).
- The B1 endpoint may not exist yet when Task 8 runs — that's expected; the fallback path is the deliverable, and the test mocks both branches.
- Keep legacy `ConsoleShell` and its tests passing at every step — the flag is default-off, so the legacy path is still the production default after F2.
