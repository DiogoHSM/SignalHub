# F2 · Console v2 — App shell

**Epic:** [SignalMonitor Console v2 — dark redesign](https://linear.app/data4ward/project/signalmonitor-console-v2-dark-redesign-d974e381fc64)
**Issue:** PER-343
**Date:** 2026-06-21
**Status:** Draft for review
**Depends on:** F1 (PER-342, design system + `.sh-v2` primitives). Soft-depends on B1 (PER-344, fleet rollup) for real Health Rail data.

## Goal

Build the v2 three-column shell — left icon nav, top bar, and the persistent collapsible cross-project **Health Rail** — and make it the app frame **behind a flag**, hosting both finished v2 screens and still-light legacy screens during the migration. After F2, navigating the v2 shell works end-to-end; individual screens get replaced one PR at a time (S1–S10).

Design source (mirror in `.claude/design-v2/`): `app-shell.jsx` (`NavRail`, `ProjectSwitcher`, `Breadcrumb`, `TopBar`, `ToastStack`), `app-health-rail.jsx` (`HealthRail`, `FleetBar`, `InfraDots`, `ProjectCard`), `app-data.jsx` (data shape), and the shell CSS + `App` root wiring in `SignalHub Console v2.html`. Match them at the F1 fidelity bar.

## Decision (locked): rollout = flag-gated, hosts both

The v2 shell is a new app frame selected by a flag; **default-off** at first, flip the default once enough screens land. Its content area renders v2 screens inside `.sh-v2` (dark) and not-yet-migrated legacy screens inside a light "legacy island" (below). Prod is untouched until the flip; rollback is flipping the flag back.

## Architecture

### 1. Flag selection (`App.tsx`)

`App.tsx` chooses the shell:

```tsx
const useV2Shell = resolveV2ShellFlag();   // ?v2=1 / ?v2=0 → persists to localStorage "sh_v2_shell"; else stored value; else false
return useV2Shell ? <ConsoleShellV2 /> : <ConsoleShell />;
```

- `resolveV2ShellFlag()` (new `src/v2/flag.ts`): query param `?v2=1`/`?v2=0` wins and is written to `localStorage["sh_v2_shell"]`; otherwise the stored boolean; otherwise `false`. This lets anyone opt in/out by URL, and the default flips later by changing the fallback to `true` (one line).
- No build-time env needed; keeps the toggle runtime and reversible.

### 2. `ConsoleShellV2` — the v2 frame (new `src/v2/ConsoleShellV2.tsx`)

The React port of the design's `App` root + shell. Renders the `.sh-v2` wrapper so F1 tokens apply to the whole frame:

```
<div className="sh-v2">
  <div className="app" data-rail={collapsed ? "collapsed" : "open"}>
    <NavRail .../>            {/* left 64px */}
    <div className="app-main">
      <TopBar .../>           {/* 56px: project+env switchers, breadcrumb, search, actions */}
      <div className="app-workspace"><div className="page" key={seq} data-anim={anim}>{content}</div></div>
    </div>
    <HealthRail .../>         {/* right rail, collapsible */}
    <ToastStack .../>
  </div>
</div>
```

State ported from the design's `App` (`useState`): `nav` (active section), `projectId`, `env`, `railCollapsed`, `drillStack`, `expandedIds`, `anim`/`seq` (page-transition remount), toasts. Persist `{nav, projectId, env, railCollapsed}` to `localStorage["sh_v2_state"]` (design's `STORE_KEY`). Page-transition animations (`nav`/`forward`/`back`) and the drill stack (breadcrumb) port verbatim.

This component reuses the project/environment data the legacy console already loads. To avoid duplicating ConsoleShell's substantial data-loading logic, F2 extracts the shared project/env loading into a small hook (`useConsoleProjects`) consumed by both shells (see §6).

### 3. Shell sub-components (`src/v2/shell/`)

Port from `app-shell.jsx` + `app-health-rail.jsx`, typed, using F1 primitives (`Icon`, `StatusDot`, `MicroSpark`, `ToastView`, `sev`):

- **`NavRail`** — icon items (overview, investigate, incidents+critical-dot, llm, traces, alerts) + bottom (system, settings); active indicator, hover tooltips. Wired to `onNavigate`.
- **`TopBar`** + **`ProjectSwitcher`** + **`Breadcrumb`** — project & environment **pill** dropdowns (real projects/envs from `useConsoleProjects`), breadcrumb from the drill stack, ⌘K search affordance (opens the existing command palette — reuse, don't rebuild), refresh / notifications / avatar, show-rail button when collapsed.
- **`HealthRail`** + `FleetBar`/`InfraDots`/`ProjectCard` — fleet rollup card, per-project cards (status stripe, metrics, `MicroSpark`, infra dots, expandable env accordion), collapsed mode, live "updated Xs ago". Data from §4.
- **`ToastStack`** — the controller (F1 shipped only the presentational `ToastView`): a `useToasts` hook (queue, auto-dismiss ~3.4s, `toast()`/`dismiss()`), rendering `ToastView`s. The design's `ToastStack` markup + `.toast-stack` positioning belong here.

### 4. Health Rail data + graceful fallback

`HealthRail` consumes a `useFleet()` hook calling **`GET /query/fleet`** (B1). Until B1 ships (or on error), `useFleet` returns a **degraded rollup derived from the already-loaded project list** — projects shown with `status: "idle"`/unknown metrics and a small "fleet metrics unavailable" note — so the rail renders structurally and the shell is never blocked. When B1 lands, swap the fetch on; no component change. The fallback path is covered by a test.

### 5. Coexistence: the legacy island (the migration bridge)

The workspace renders the active screen via a **screen registry** (`src/v2/screens/registry.tsx`):

```ts
type ScreenEntry = { kind: "v2" | "legacy"; render: (ctx) => ReactNode };
const SCREENS: Record<NavSection, ScreenEntry> = { ... };
```

- **`kind: "v2"`** → rendered directly in the workspace (inherits `.sh-v2`, dark). At F2 time the registry has **zero** v2 screens; each S1–S10 PR flips one entry to `v2`.
- **`kind: "legacy"`** → rendered inside `<div className="console-legacy-island">{<LegacyScreen/>}</div>`. The island **re-establishes the legacy light token values** so the legacy screen looks exactly as it does today, even though it sits inside `.sh-v2`.

The island token reset is the one sanctioned touch to legacy CSS: extend the legacy token block's selector in `styles.css` from `:root {` to `:root, .console-legacy-island {` (no value duplication — the island just re-declares the same custom properties at a deeper scope, overriding `.sh-v2`). Plus `.console-legacy-island { color-scheme: light; height: 100%; overflow: auto; }`. This island is temporary scaffolding; when the registry has no `legacy` entries left, the island and that selector addition are deleted (tracked in the X cleanup issue).

At F2, every nav target maps to its closest existing legacy view (e.g. overview→legacy Overview/Operations, investigate→Analyze, incidents→Errors, llm→Analyze#llm, traces→Traces, alerts→Alerts, system→System, settings→Configure). Exact mapping is a plan detail; the point is the v2 chrome is fully navigable on day one with real (light) content inside it.

### 6. Shared project/env loading (`src/v2/useConsoleProjects.ts`)

Extract the project list + environments + active selection loading currently embedded in `ConsoleShell.tsx` into a hook both shells use. This avoids duplicating fetch logic and keeps the two shells in sync on the same data. Scope the extraction tightly — move the loading/state, leave ConsoleShell's other concerns in place. (This is the targeted "improve code you're touching" refactor; if extraction proves too entangled for F2, fall back to a thin v2-only loader and note the duplication for later.)

### 7. Shell CSS (`src/styles/v2/shell.css`)

Port the shell layout CSS from `SignalHub Console v2.html`'s `<style>` block — `.app` grid + rail transition, `.nv*` nav, `.app-main`/`.app-workspace`/`.page` + `@keyframes pgFade/pgFwd/pgBack`, `.tb*` top bar + `.sw-*` switcher menus, `.hr*` health rail (incl. collapsed), `.inv-tabs` (used by later screens — include), `.toast*` toasts, and the scrollbar rules. **Scope every selector under `.sh-v2`** (same rule as F1; these were the shell-layout blocks F1 deliberately deferred). Add to `src/styles/v2/index.css`. Keep the `sh-ping`/`sh-pulse` keyframes from F1; add the `pg*`/`menuIn`/`toastIn` keyframes here.

## Testing

- **flag.ts** — `?v2=1` opts in + persists; `?v2=0` opts out; stored value respected; default false.
- **App.tsx** — renders `ConsoleShellV2` when flag on, `ConsoleShell` when off.
- **ConsoleShellV2** — renders nav/topbar/rail; nav click changes the active screen; project/env switch updates context + persists to `localStorage`; rail collapse toggles + persists; drill → breadcrumb push/pop; toast appears then auto-dismisses (fake timers).
- **Screen registry / legacy island** — a `legacy` entry renders inside `.console-legacy-island`; (later) a `v2` entry renders without the island.
- **useFleet fallback** — with the endpoint unavailable, returns a degraded rollup and the rail still renders project cards.
- **ToastStack controller** — `toast()` enqueues, auto-dismiss removes after the timeout, `dismiss()` removes immediately.
- **NavRail/TopBar/HealthRail** — structural + interaction (active item, switcher open/select, rail expand/collapse, env accordion).
- **No regression:** legacy `ConsoleShell` path and its tests untouched; default-off means existing behavior is the default.

## Verification

```sh
pnpm --filter @sigmon/console test
pnpm --filter @sigmon/console build
pnpm --filter @sigmon/console lint
pnpm test   # repo-wide, incl. branding contract
```

Manual: load `/console?v2=1` → v2 dark shell with working nav, project/env switchers, collapsible Health Rail (fallback or B1 data), and legacy screens rendering light inside the frame; `/console?v2=0` → unchanged legacy console.

## Out of scope (F2)

- v2 **screen content** (S1–S10) — F2 only frames them; the registry starts with all-legacy entries.
- The B1 endpoint itself (separate track) — F2 consumes it with a fallback.
- Deleting the legacy island / legacy ConsoleShell — happens after migration (X cleanup).
- Command-palette redesign — F2 reuses the existing palette behind ⌘K.

## Risks / notes

- **Legacy island token reset** is the crux. If re-declaring tokens on `.console-legacy-island` proves insufficient for some legacy screen that reads tokens in unusual ways, fall back to rendering legacy screens in a portal outside the `.sh-v2` subtree. Flag if hit.
- **`useConsoleProjects` extraction** risk — ConsoleShell's data flow is substantial (see its 39 tests). Keep the extraction minimal and re-run ConsoleShell's tests to prove no regression; if entangled, use a v2-local loader and defer the dedupe.
- **⌘K / command palette** must keep working in both shells — reuse the existing component; don't fork it.
- Health Rail fidelity (micro-sparks, infra dots, accordion timing) matters — port the design's CSS transitions verbatim.
