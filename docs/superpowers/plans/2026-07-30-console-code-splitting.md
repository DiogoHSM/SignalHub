# Console Code Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task.

**Goal:** Reduce the production console's initial JavaScript below Vite's 500 kB warning threshold while preserving navigation, deep links, authentication, and consistent loading/error feedback.

**Baseline:** Before splitting, the production console emits one `index` JavaScript chunk of 717.10 kB raw / 177.79 kB gzip. The build reports Vite's 500 kB chunk warning.

**Architecture:** Keep the shell, authentication, navigation, command palette, project/environment state, and fleet rail in the entry chunk. Load screen groups on demand through `React.lazy`: operations, observability, analytics/experimentation, and administration. Reuse each group import promise so neighboring screens share a coherent chunk rather than creating one chunk per small screen. Lazy-load incident and tenant detail screens through their owning group. Wrap screen loading in a design-system-aligned fallback and an error boundary with an explicit retry action.

**Tech Stack:** React 19, TypeScript, Vite/Rollup, Vitest, Testing Library.

### Task 1: Lazy Screen Groups

- [x] Add a failing registry contract test proving screen workspaces are loaded through dynamic group imports and render a consistent loading state.
- [x] Create coherent operations, observability, analytics/experimentation, and administration screen group modules.
- [x] Replace eager screen imports in the registry and shell detail paths with shared lazy group loaders.
- [x] Add a screen-level error boundary with retry feedback that follows the v2 design system.

### Task 2: Navigation And Deep-Link Regression Coverage

- [x] Update registry tests for asynchronous lazy rendering without weakening v2-only assertions.
- [x] Verify shell navigation, incident detail, tenant detail, command palette, authentication, and persisted/deep-linked state tests.
- [x] Add regression coverage for a failed lazy import and retry where practical.

### Task 3: Bundle Measurement And Final Verification

- [x] Run console tests, lint, and production build.
- [x] Record initial and final raw/gzip entry sizes and list the resulting coherent screen chunks.
- [x] Confirm the entry chunk is below 500 kB without raising the warning limit.
- [x] Run the full repository suite, build, lint, and `git diff --check`.
- [x] Request independent review and update architecture, UI/UX, deployment documentation, and Linear PER-457.

**Final measurement:** The entry is 285.31 kB raw / 83.31 kB gzip. Lazy workspace chunks are observability 97.08 / 22.01 kB, administration 98.43 / 23.59 kB, analytics/experimentation 114.07 / 23.76 kB, and operations 122.57 / 28.95 kB (raw / gzip). Canonical section, incident, and tenant URLs retain project/environment scope and restore through browser history.
