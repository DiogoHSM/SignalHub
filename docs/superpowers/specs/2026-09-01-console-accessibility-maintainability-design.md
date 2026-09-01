# Console Accessibility, Responsive Scope, and Style Primitives Design

**Linear:** PER-511, PER-512, PER-513

## Goal

Bring audited console interactions to WCAG AA, make the supported narrow-width boundary honest, and consolidate repeated visual rules without changing the current dark observability design.

## Non-goals

- Reintroducing the previous dark-redesign implementation wholesale.
- Reproducing every dense investigation workflow on a phone.
- A new component library or visual identity.
- Implementing currently unavailable product features merely because a button exists.

## Accessibility

Semantic foreground tokens must measure at least 4.5:1 for normal text against every background where they are used. Faint text that cannot meet that threshold becomes decorative or uses a stronger token. Severity colors retain non-color labels or icons.

The top-bar search affordance becomes a native button that opens/focuses search and has an accessible name. Selectable trace rows expose keyboard focus, `role="button"`, and Enter/Space activation without interfering with their nested expand control. Focus-visible styling uses a shared ring token.

Interactive hit areas are at least 44 by 44 CSS pixels for top-bar, navigation, rail, row expand, icon, and toast-dismiss actions. Glyphs may remain visually compact inside the hit area. A scoped `prefers-reduced-motion: reduce` rule removes page, menu, pulse, accordion, and toast animation while preserving final states.

## Responsive boundary

`/console/status` remains the phone-focused operational surface. Below 900 CSS pixels, dense investigative routes render a clear boundary page with a direct link to status rather than overlapping or clipping. From 900 pixels upward, audited grids use `minmax`, controlled overflow, or stacking so tablet/narrow-desktop layouts remain usable.

The boundary is route-aware and does not hide authentication or the status view. Desktop behavior at 1280 pixels and above remains unchanged.

Unavailable actions are removed when they have no meaningful disabled-state explanation. Actions that depend on an unmet condition remain visible only when the condition can be explained through `disabled`, `aria-disabled`, and adjacent/help text. Toast-only simulations of unimplemented behavior are removed.

## Style primitives

After accessibility and responsive behavior are green, extract only the repeated rules touched by those fixes:

- interactive hit-area and focus-ring classes;
- responsive investigation grids;
- semantic foreground/severity mappings;
- row-button behavior;
- common spacing and compact icon-button sizes.

Direct colors move into `tokens.css`. Inline styles remain acceptable for truly data-dependent values such as measured widths, grid spans, and chart coordinates. Static layout/color/typography objects in the audited Overview, Traces, Tenant, LLM, and dashboard surfaces move to classes.

A source-contract test rejects new hex/rgb/hsl/oklch literals outside token and approved visualization files. A second metric test records and lowers the audited surfaces' static inline-style baseline by at least 25 percent; it prevents regression without demanding a repository-wide rewrite.

## Reuse from the historical redesign

The previous project remains an archive. Reuse is limited to principles that still fit current behavior: dense but readable investigation surfaces, the narrow navigation rail, operational overview hierarchy, and incident-centered response. Old components are not copied merely because they are visually related.

## Acceptance criteria

- Audited normal text meets 4.5:1 contrast, and focus is visible.
- Core search and trace interactions work with keyboard alone.
- Reduced-motion mode removes non-essential animation and pulse.
- Audited action hit areas meet 44 by 44 pixels.
- Narrow routes neither overlap nor pretend to support dense phone investigation.
- Every visible audited affordance works or is honestly disabled; fake actions are absent.
- Static inline styles in audited surfaces fall at least 25 percent and direct colors are tokenized.

## Verification

Add component keyboard/focus tests, CSS contract tests, reduced-motion assertions, automated contrast calculations, viewport tests at 390/768/900/1280 pixels, affordance behavior tests, and inline-style/color guards. Run the console suite and build, then verify representative routes in the browser at the four widths.
