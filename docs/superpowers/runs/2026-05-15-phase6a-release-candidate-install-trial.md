# Phase 6A Release Candidate Install Trial Run

## Summary

- **Status:** In progress
- **Commit under test:** `a342c67`
- **Trial checkout:** `/private/tmp/signalhub-phase6a-rc`
- **Compose project:** `signalhub_phase6a_rc`
- **API URL:** `http://localhost:3000`
- **Console URL:** `http://localhost:3000/console`
- **Started:** `2026-05-15 18:30 America/Sao_Paulo`
- **Completed:** `pending`
- **Final recommendation:** `pending`

## Environment

| Item | Value |
| --- | --- |
| Host OS | `macOS 26.3.1 (a), build 25D771280a` |
| Node.js | `v25.9.0` |
| pnpm | `9.15.4` |
| Docker | `Docker version 29.4.2, build 055a478` |
| Docker Compose | `Docker Compose version v5.1.3` |
| Trial checkout path | `/private/tmp/signalhub-phase6a-rc` |
| Fresh volumes confirmed | `not yet` |

## Command Log

| Step | Command | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| 2.1 | `git rev-parse --short HEAD` | Print commit under test | `a342c67` | pass |
| 2.2 | `git clone /Users/diogo/Developer/Github/SignalHub/.worktrees/phase6a-install-trial /private/tmp/signalhub-phase6a-rc` | Local clone succeeds without network | Clone completed | pass |
| 2.3 | `git -C /private/tmp/signalhub-phase6a-rc status -sb` | Clean checkout | `## codex/phase6a-install-trial...origin/codex/phase6a-install-trial` | pass |
| 2.4 | `git -C /private/tmp/signalhub-phase6a-rc rev-parse --short HEAD` | Match commit under test | `a342c67` | pass |
| 2.5 | `sw_vers` | Print host OS version | `macOS 26.3.1 (a), build 25D771280a` | pass |
| 2.6 | `node --version` | Document host Node.js version | `v25.9.0` | pass |
| 2.7 | `pnpm --version` | Document pnpm version | `9.15.4` | pass |
| 2.8 | `docker --version` | Document Docker version | `Docker version 29.4.2, build 055a478` | pass |
| 2.9 | `docker compose version` | Document Docker Compose version | `Docker Compose version v5.1.3` | pass |
| 3.1 | `cp .env.example .env` plus configured secret replacements | Trial `.env` exists with non-placeholder local values | `.env` prepared for `phase6a-admin@example.com` | pass |
| 3.2 | `rg -n "change-me\|signalhub-local-only-change-me" /private/tmp/signalhub-phase6a-rc/.env` | No known placeholder values remain | No matches; command exited 1 | pass |
| 3.3 | `pnpm install` | Dependencies install successfully | Exited 0; lockfile was already up to date but trial checkout became dirty with `packages/cli: {}` importer | friction |
| 3.4 | `pnpm run doctor` | Pre-start diagnostics exit 0 | Exited 0 with warnings for missing/unwritable `SOURCE_MAPS_LOCAL_DIR` and unreachable API health/readiness before startup | pass |
| 3.5 | `docker compose -p signalhub_phase6a_rc config --quiet` | Compose config renders successfully | Exited 0 | pass |

## Drill Results

| Step | Result | Evidence |
| --- | --- | --- |
| Clean checkout prepared | pass | `/private/tmp/signalhub-phase6a-rc` is clean on `codex/phase6a-install-trial` at `a342c67`. |
| `.env` prepared with non-placeholder secrets | pass | `.env` was created from `.env.example`; placeholder scan returned no matches. |
| Pre-start doctor | pass | `pnpm run doctor` exited 0 with expected pre-start warnings for API reachability and source-map local directory availability. |
| Compose config render | pass | `docker compose -p signalhub_phase6a_rc config --quiet` exited 0. |
| Dependencies started | pending | pending |
| Bootstrap admin seeded | pending | pending |
| Full stack started | pending | pending |
| Compose-aware doctor | pending | pending |
| Health and readiness | pending | pending |
| Console login | pending | pending |
| Project/environment/API key setup | pending | pending |
| Event ingestion and query | pending | pending |
| Error ingestion, grouping, and raw drilldown | pending | pending |
| Trace/span ingestion and query | pending | pending |
| LLM ingestion and aggregate query | pending | pending |
| Breadcrumb ingestion and error session context | pending | pending |
| Entities and Users visibility | pending | pending |
| Source-map token creation | pending | pending |
| Source-map upload | pending | pending |
| Source-map resolution | pending | pending |
| System health visibility | pending | pending |
| Manual backup | pending | pending |
| Guarded restore | pending | pending |
| Post-restore smoke | pending | pending |
| Final verification | pending | pending |

## Findings

### Finding 1: Host Node Version Differs From Documented Prerequisite

- **Class:** Release friction candidate
- **Expected:** `README.md` lists Node.js 22 as the prerequisite.
- **Actual:** The trial host reports Node.js `v25.9.0`.
- **Evidence:** `node --version`; `pnpm run doctor` still reported `[PASS] Node.js version check passed`.
- **Impact:** Not a blocker. Classify during Task 9 as either acceptable version-range behavior or documentation precision follow-up.

### Finding 2: `pnpm install` Dirties The Trial Checkout Lockfile

- **Class:** Release friction candidate
- **Expected:** `pnpm install` in a fresh checkout should leave committed files unchanged when the lockfile is current.
- **Actual:** The trial checkout `pnpm-lock.yaml` gained an empty `packages/cli: {}` importer.
- **Evidence:** `git -C /private/tmp/signalhub-phase6a-rc diff -- pnpm-lock.yaml`
- **Impact:** Not a runtime blocker. Classify during Task 9; likely a small lockfile consistency fix if repeated in the main worktree.

## Fixes Made

No fixes made yet.

## Follow-Ups

No follow-ups recorded yet.

## Final Recommendation

Pending completion of the drill.
