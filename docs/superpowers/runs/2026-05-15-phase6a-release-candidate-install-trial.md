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

## Drill Results

| Step | Result | Evidence |
| --- | --- | --- |
| Clean checkout prepared | pass | `/private/tmp/signalhub-phase6a-rc` is clean on `codex/phase6a-install-trial` at `a342c67`. |
| `.env` prepared with non-placeholder secrets | pending | pending |
| Pre-start doctor | pending | pending |
| Compose config render | pending | pending |
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
- **Evidence:** `node --version`
- **Impact:** Pending Task 3 doctor output. Continue the drill unless diagnostics or runtime behavior fail.

## Fixes Made

No fixes made yet.

## Follow-Ups

No follow-ups recorded yet.

## Final Recommendation

Pending completion of the drill.
