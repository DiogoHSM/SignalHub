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
