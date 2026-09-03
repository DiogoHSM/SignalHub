# Task 3 Report: Enforce server-only identify and update clients

## Implementation

- Added a server-capability guard before payload parsing and persistence for both identify routes. Browser keys now receive `403 { "error": "api_key_capability_forbidden" }`; server keys retain `202` behavior.
- Added required browser/server capability data contracts to console API key types and creation input.
- Added an explicit Settings key-creation form with browser default, server selection, capability display, explanatory copy, one-time-secret propagation, and in-memory list update. Setup creation explicitly requests `browser`.
- Updated HTTP and README guidance: browser keys remain safe for telemetry; upgraded keys are browser-safe; server identify integrations must create or rotate a server key.

## TDD Evidence

- RED API: `pnpm vitest run apps/api/test/identify.test.ts` failed as intended with browser user and tenant identify requests returning `202` instead of `403`.
- GREEN API: the same test file passed after the guards were added: 7/7 tests.
- RED console: the settings test could not find `New API key`, and the setup test showed the missing `capability: "browser"` request field.
- GREEN console: the focused serial suite below passed 77/77 tests.

## Verification

- `pnpm vitest run apps/api/test/identify.test.ts apps/console/src/v2/screens/settings/ProjectSettingsSection.test.tsx apps/console/src/v2/screens/SetupScreen.test.tsx apps/console/src/v2/ConsoleShellV2.test.tsx --reporter=dot --no-file-parallelism` — PASS, 4 files and 77 tests.
- `pnpm --filter @sigmon/api build` — PASS.
- `pnpm --filter @sigmon/console build` — PASS (TypeScript and Vite).
- `git diff --check` — PASS.

The requested focused command without `--no-file-parallelism` exposed two unrelated ConsoleShell route tests that pass alone and in serial; concurrent files share browser-global state. The serial run is the valid final verification and no unrelated routing code was changed.

## Files

`apps/api/src/routes/identify.ts`, `apps/api/test/identify.test.ts`, `apps/console/src/api/types.ts`, `apps/console/src/api/client.ts`, `apps/console/src/v2/screens/SetupScreen.tsx`, `apps/console/src/v2/screens/useSetup.ts`, `apps/console/src/v2/screens/settings/ProjectSettingsSection.tsx`, `apps/console/src/v2/screens/settings/useProjectSettings.ts`, their focused tests, `apps/console/src/v2/ConsoleShellV2.test.tsx`, `docs/HTTP-INGESTION.md`, and `README.md`.

## Self-review and concerns

The guards run after authentication and before parsing/persistence on both profile mutation routes; ordinary telemetry was untouched. Console key contracts are required end-to-end and tests cover the default browser and selected server path. Concern: the existing focused suite is order-sensitive under file parallelism because of shared browser globals; this task does not alter that unrelated test infrastructure.

## Fix Round 1

### Implementation

- Replaced the generic one-time-secret kind with `browserApiKey` and `serverApiKey`. Setup only reads `browserApiKey`, so a Settings-created server key cannot enter a Browser snippet.
- Settings now tags a created key from its returned capability. A server key is shown once in the Settings API-keys panel, masked by default with copy/reveal controls and server-side-storage guidance; it is never rendered by Setup.
- Cancelling or toggling the Settings creation form resets its name and capability to the browser default.
- The two direct-route ConsoleShell assertions now wait up to five seconds for the UI. This is a test-only readiness fix, not a serialized runner workaround.

### TDD RED/GREEN

- RED: `pnpm vitest run apps/console/src/v2/screens/SetupScreen.test.tsx apps/console/src/v2/screens/settings/ProjectSettingsSection.test.tsx apps/console/src/v2/ConsoleShellV2.test.tsx --reporter=dot --no-file-parallelism` failed 3 regressions: server key text appeared in the Browser snippet (Setup and real shell), and cancelling/reopening preserved `backend-identify` instead of an empty browser-default form.
- GREEN: the same serial command passed 73/73 after the secret-kind boundary, Settings presentation, and reset helper were added.

### Parallel focused-command investigation

- Initial prescribed non-serial command failed: `ConsoleShellV2 > opens a canonical section URL directly` failed after 1172ms with `Unable to find role="heading" and name "Traces"`; API, Settings, and Setup files passed.
- The ConsoleShell file passed alone (36/36). Explicit `--isolate` and `--pool=forks` still reproduced the failure, while the root Vitest configuration and CLI both report per-file isolation enabled by default. This ruled out a disabled-isolation/shared-DOM configuration defect.
- The failing assertions used Testing Library's 1s default and the concurrent run delayed initial jsdom rendering past that bound. Raising only the two direct-route readiness waits to 5s made the unchanged prescribed command pass; this preserves file parallelism.
- Repeat evidence: `pnpm vitest run apps/api/test/identify.test.ts apps/console/src/v2/screens/settings/ProjectSettingsSection.test.tsx apps/console/src/v2/screens/SetupScreen.test.tsx apps/console/src/v2/ConsoleShellV2.test.tsx --reporter=dot` — PASS, 4 files / 80 tests.

### Exact verification

- `pnpm vitest run apps/console/src/v2/screens/ReadTokensSection.test.tsx apps/console/src/v2/screens/useReadTokens.test.ts --reporter=dot` — PASS, 2 files / 26 tests.
- `pnpm --filter @sigmon/api build` — PASS (`tsc -p tsconfig.json --noEmit`).
- `pnpm --filter @sigmon/console build` — PASS (TypeScript and Vite; 1682 modules transformed).
- `git diff --check` — PASS.

### Files and self-review

Changed `registry.tsx`, `useSetup.ts`, `useProjectSettings.ts`, `ProjectSettingsSection.tsx`, the Settings/Setup/ConsoleShell regressions, and the read-token secret-kind test fixtures. Reviewed that every producer assigns an explicit credential-surface kind, Setup consumes only `browserApiKey`, Settings consumes only `serverApiKey`, and clearing the server presentation keeps the explicit server kind. No deferred minor-ledger work was expanded. Remaining concern: parallel cold-start timing is now tolerated by the two affected UI assertions; no production behavior is affected.
