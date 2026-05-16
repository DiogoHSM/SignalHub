# Phase 6A Release Candidate Install Trial Run

## Summary

- **Status:** Complete
- **Commit under test:** `a342c67`
- **Trial checkout:** `/private/tmp/signalhub-phase6a-rc`
- **Compose project:** `signalhub_phase6a_rc`
- **API URL:** `http://localhost:3000`
- **Console URL:** `http://localhost:3000/console`
- **Started:** `2026-05-15 18:30 America/Sao_Paulo`
- **Completed:** `2026-05-16 01:24 America/Sao_Paulo`
- **Final recommendation:** `Ready for Phase 6B automated smoke planning`

## Environment

| Item | Value |
| --- | --- |
| Host OS | `macOS 26.3.1 (a), build 25D771280a` |
| Node.js | `v25.9.0` |
| pnpm | `9.15.4` |
| Docker | `Docker version 29.4.2, build 055a478` |
| Docker Compose | `Docker Compose version v5.1.3` |
| Trial checkout path | `/private/tmp/signalhub-phase6a-rc` |
| Fresh volumes confirmed | `yes: no signalhub_phase6a_rc_* volumes existed before first start` |

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
| 4.1 | `docker volume ls --format '{{.Name}}' \| rg '^signalhub_phase6a_rc_'` | No existing trial volumes | No matches; command exited 1 | pass |
| 4.2 | `docker compose -p signalhub_phase6a_rc up -d postgres redis` | Postgres and Redis start | Containers started and became healthy | pass |
| 4.3 | `docker compose -p signalhub_phase6a_rc run --rm api pnpm seed:admin` | Bootstrap admin is seeded | Image built and `Bootstrap admin created` | pass |
| 4.4 | `docker compose -p signalhub_phase6a_rc up -d --build` | Full stack starts | API and worker containers started | pass |
| 4.5 | `docker compose -p signalhub_phase6a_rc ps` | Services are running | Postgres/Redis healthy; API/worker running | pass |
| 4.6 | `pnpm run doctor -- --compose --api-url http://localhost:3000` | Compose-aware diagnostics exit 0 | Exited 0; all running-service checks passed; `SOURCE_MAPS_LOCAL_DIR` host warning remained | pass |
| 4.7 | `curl -fsS http://localhost:3000/health` | API health responds | `{"ok":true}` | pass |
| 4.8 | `curl -fsS http://localhost:3000/ready` | API readiness responds | `{"ok":true,"checks":{"postgres":true,"redis":true}}` | pass |
| 5.1 | `curl -fsS -c /private/tmp/signalhub-phase6a-cookies.txt ... /auth/login` with `phase6a-admin@example.com` | Login succeeds with planned admin email | Returned HTTP 401 | friction |
| 5.2 | `docker compose -p signalhub_phase6a_rc exec -T postgres psql ... select email from users` | Identify seeded bootstrap admin email | Database contained `admin@example.com` | pass |
| 5.3 | `curl -fsS -c /private/tmp/signalhub-phase6a-cookies.txt ... /auth/login` with `admin@example.com` | Login succeeds with actual seeded admin | Returned admin session user | pass |
| 5.4 | `curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt http://localhost:3000/auth/me` | Session cookie is valid | Returned `admin@example.com` admin user | pass |
| 5.5 | `curl ... -d '{"name":"Phase 6A RC Project"}' http://localhost:3000/admin/projects` | Create RC project | Created `prj_z78juzi3y5clme31hsrzk9vx` | pass |
| 5.6 | `curl ... /admin/projects/prj_z78juzi3y5clme31hsrzk9vx/environments` | Create `production` environment | Created `env_4vs5de0d613e7cssjy5i5gdf` | pass |
| 5.7 | `curl ... /admin/projects/prj_z78juzi3y5clme31hsrzk9vx/api-keys` | Create ingestion API key | Created `key_d97a2i5bnz5bkl8rpm465zy0`; one-time secret stored only under `/private/tmp` | pass |
| 6.1 | `POST /v1/events` with token read from `/private/tmp` | Event accepted | Returned HTTP 202 with `evt_d3o5liba4v2zu8sxxro6rpfg` | pass |
| 6.2 | `POST /v1/errors`, `/v1/traces`, `/v1/spans`, `/v1/llm`, `/v1/breadcrumbs` | Core signals accepted | Each endpoint returned HTTP 202 with accepted IDs | pass |
| 6.3 | `sleep 5` | Allow worker persistence | Completed | pass |
| 6.4 | Query Events, Errors, Error Groups, Traces, Spans, LLM, LLM aggregate, Entities, Users, and Session Timeline | Smoke data is queryable | Verification script found all expected Phase 6A markers | pass |
| 7.1 | Browser login at `http://localhost:3000/console` | Console login succeeds | Authenticated console loaded for `admin@example.com` | pass |
| 7.2 | Browser mode checks for Setup, Overview, Investigate, Artifacts, and System | Primary console surfaces load | Overview/System loaded; Investigate views showed Phase 6A markers across Events, Errors, Traces, LLM, Entities, and Users | pass |
| 7.3 | `POST /admin/source-map-upload-tokens` | Create source-map upload token | Created `smtok_ms9b3gl03cixjhwpur5yr9ie`; one-time secret stored only under `/private/tmp` | pass |
| 7.4 | `pnpm source-maps:upload -- --endpoint ...` | Upload source map by documented CLI style | Failed with `Unknown option` because the CLI received a literal `--` | friction |
| 7.5 | `pnpm source-maps:upload --file ... --minified-file app.min.js` with env vars | Upload source map by working CLI style | Uploaded 1 source map artifact for `app.min.js` | pass |
| 7.6 | `GET /query/errors/err_f3owa13f9p8e0mc3mr9e2wu1/source-map-resolution` | Resolve matching stack frame | Response included `src/app.ts`, line 42, name `checkout` | pass |
| 7.7 | `GET /system/health` | System health includes operational status | Response included service health, `retention.policy.sourceMaps*`, and `backups` status | pass |
| 8.1 | `docker compose -p signalhub_phase6a_rc run --rm worker pnpm backup:create` | Manual backup completes | `Backup completed`; latest dump path `/var/lib/signalhub/backups/signalhub-20260516T021742Z.dump` | pass |
| 8.2 | `docker compose -p signalhub_phase6a_rc stop api worker` | API and worker stop before restore | Both services stopped | pass |
| 8.3 | `docker compose -p signalhub_phase6a_rc run --rm worker pnpm backup:restore -- "$BACKUP_PATH"` | Restore refuses to run without explicit confirmation | Failed with `Restore requires --yes` | pass |
| 8.4 | `docker compose -p signalhub_phase6a_rc run --rm worker pnpm backup:restore -- "$BACKUP_PATH" --yes` | Confirmed restore completes | `Backup restored` | pass |
| 8.5 | `docker compose -p signalhub_phase6a_rc start api worker` | API and worker restart | Both services started | pass |
| 8.6 | `curl -fsS http://localhost:3000/health` | API health responds after restore | `{"ok":true}` | pass |
| 8.7 | `curl -fsS http://localhost:3000/ready` | API readiness responds after restore | `{"ok":true,"checks":{"postgres":true,"redis":true}}` | pass |
| 8.8 | `pnpm run doctor -- --compose --api-url http://localhost:3000` | Post-restore diagnostics pass | Initially failed because `tsx` resolved through an external pnpm virtual store; after reinstalling trial dependencies with `--config.virtual-store-dir=node_modules/.pnpm`, doctor exited 0 with the known `SOURCE_MAPS_LOCAL_DIR` warning | friction |
| 8.9 | Query restored Events, Errors, and Session Timeline | Known pre-backup smoke data remains queryable after restore | `/query/events` returned `phase6a.account.created`; `/query/errors` returned `err_f3owa13f9p8e0mc3mr9e2wu1`; `/query/sessions/sess_phase6a/timeline` returned trace, event, error, LLM, and breadcrumb items | pass |

## Drill Results

| Step | Result | Evidence |
| --- | --- | --- |
| Clean checkout prepared | pass | `/private/tmp/signalhub-phase6a-rc` is clean on `codex/phase6a-install-trial` at `a342c67`. |
| `.env` prepared with non-placeholder secrets | pass | `.env` was created from `.env.example`; placeholder scan returned no matches. |
| Pre-start doctor | pass | `pnpm run doctor` exited 0 with expected pre-start warnings for API reachability and source-map local directory availability. |
| Compose config render | pass | `docker compose -p signalhub_phase6a_rc config --quiet` exited 0. |
| Dependencies started | pass | `docker compose -p signalhub_phase6a_rc up -d postgres redis` started fresh Postgres and Redis containers with healthy status. |
| Bootstrap admin seeded | pass | `docker compose -p signalhub_phase6a_rc run --rm api pnpm seed:admin` exited 0 and created the bootstrap admin. |
| Full stack started | pass | `docker compose -p signalhub_phase6a_rc up -d --build` started API and worker; `docker compose ps` showed all four services running. |
| Compose-aware doctor | pass | `pnpm run doctor -- --compose --api-url http://localhost:3000` exited 0 with all running-service checks passing. |
| Health and readiness | pass | `/health` returned `{"ok":true}` and `/ready` returned healthy Postgres/Redis checks. |
| Console login | pass | HTTP login succeeded with the actual seeded admin `admin@example.com`; the planned `phase6a-admin@example.com` login failed because the `.env` replacement command left the default email unchanged. |
| Project/environment/API key setup | pass | Created RC project `prj_z78juzi3y5clme31hsrzk9vx`, `production` environment `env_4vs5de0d613e7cssjy5i5gdf`, and one ingestion API key; secret was stored only in `/private/tmp`. |
| Event ingestion and query | pass | Event accepted and `/query/events` returned `phase6a.account.created`. |
| Error ingestion, grouping, and raw drilldown | pass | Error accepted; `/query/errors` returned `Phase 6A checkout failed` and `/query/error-groups` returned `phase6a-checkout-error`. |
| Trace/span ingestion and query | pass | Trace and span accepted; query endpoints returned `trace_phase6a` and `phase6a.db.query`. |
| LLM ingestion and aggregate query | pass | LLM call accepted; `/query/llm-calls` returned `phase6a_summary` and `/query/aggregates/llm` reflected the smoke cost. |
| Breadcrumb ingestion and error session context | pass | Breadcrumb accepted and `/query/sessions/sess_phase6a/timeline` returned `Phase 6A selected shipping method`. |
| Entities and Users visibility | pass | Tenant and user query surfaces returned `tenant_phase6a` and `user_phase6a`. |
| Source-map token creation | pass | Created source-map upload token `smtok_ms9b3gl03cixjhwpur5yr9ie`; secret was stored only under `/private/tmp`. |
| Source-map upload | pass | CLI uploaded `/private/tmp/signalhub-phase6a-app.min.js.map` for release `web@phase6a` and minified file `app.min.js` after using the working no-extra-`--` invocation. |
| Source-map resolution | pass | Error `err_f3owa13f9p8e0mc3mr9e2wu1` resolved to `src/app.ts` with original name `checkout`. |
| System health visibility | pass | Browser System panel loaded healthy service/operation status; `/system/health` included retention policy fields for source maps and `backups` status. |
| Manual backup | pass | `docker compose -p signalhub_phase6a_rc run --rm worker pnpm backup:create` completed and produced `/var/lib/signalhub/backups/signalhub-20260516T021742Z.dump`. |
| Guarded restore | pass | Restore without `--yes` failed with `Restore requires --yes`; restore with `--yes` completed with `Backup restored`. |
| Post-restore smoke | pass | API/worker restarted; `/health`, `/ready`, and compose-aware doctor passed after repairing the disposable checkout's pnpm virtual store layout; restored Events, Errors, and Session Timeline queries returned the known Phase 6A smoke records. |
| Final verification | pass | `pnpm test`, `pnpm build`, `docker compose config --quiet`, `pnpm run doctor`, Compose-aware doctor, `/health`, and `/ready` passed. |

## Findings

### Finding 1: Host Node Version Differs From Documented Prerequisite

- **Class:** Release friction candidate
- **Expected:** `README.md` lists Node.js 22 as the prerequisite.
- **Actual:** The trial host reports Node.js `v25.9.0`.
- **Evidence:** `node --version`; `pnpm run doctor` still reported `[PASS] Node.js version check passed`.
- **Impact:** Not a blocker. Fixed by clarifying the Node.js 22.x release baseline in operator docs.

### Finding 2: `pnpm install` Dirties The Trial Checkout Lockfile

- **Class:** Release friction candidate
- **Expected:** `pnpm install` in a fresh checkout should leave committed files unchanged when the lockfile is current.
- **Actual:** The trial checkout `pnpm-lock.yaml` gained an empty `packages/cli: {}` importer.
- **Evidence:** `git -C /private/tmp/signalhub-phase6a-rc diff -- pnpm-lock.yaml`
- **Impact:** Not a runtime blocker. Fixed by adding the missing lockfile importer and a repo-local pnpm virtual store override.

### Finding 3: Docker Build Emits Optional Native Binding Warnings

- **Class:** Release friction candidate
- **Expected:** The documented Compose build path should avoid alarming install output where practical.
- **Actual:** The API image build completed, but optional native bindings for `cpu-features` and `ssh2` emitted compiler/Python warnings inside `pnpm install --frozen-lockfile`.
- **Evidence:** `docker compose -p signalhub_phase6a_rc run --rm api pnpm seed:admin`
- **Impact:** Not a blocker because the image built and the admin seed succeeded. Deferred to a follow-up for dependency/image strategy evaluation.

### Finding 4: Host-Side Doctor Warns About Container Source Map Directory

- **Class:** Release friction candidate
- **Expected:** Compose-aware doctor should be easy to interpret after the stack is running.
- **Actual:** `pnpm run doctor -- --compose --api-url http://localhost:3000` exited 0 and all running-service checks passed, but still warned that `SOURCE_MAPS_LOCAL_DIR` is missing or not writable on the host.
- **Evidence:** `pnpm run doctor -- --compose --api-url http://localhost:3000`
- **Impact:** Not a blocker. Fixed by skipping the host writability check in compose-aware doctor runs.

### Finding 5: Planned Admin Email Replacement Did Not Apply

- **Class:** Release friction candidate
- **Expected:** The Task 3 `.env` replacement command should change `BOOTSTRAP_ADMIN_EMAIL` to `phase6a-admin@example.com`.
- **Actual:** `.env` kept `BOOTSTRAP_ADMIN_EMAIL=admin@example.com`, so login with `phase6a-admin@example.com` returned HTTP 401 while login with `admin@example.com` succeeded.
- **Evidence:** `rg -n "BOOTSTRAP_ADMIN_EMAIL" /private/tmp/signalhub-phase6a-rc/.env`; `curl ... /auth/login`; database user query.
- **Impact:** Not a product runtime blocker. Fixed by escaping `@` in the Phase 6A plan's `.env` replacement command.

### Finding 6: Chained Shell Commands With Runtime Variables Were Brittle In The Drill Harness

- **Class:** Release friction candidate
- **Expected:** The scripted curl examples using command substitution should be reliable enough to follow during the drill.
- **Actual:** Chained shell commands using `PROJECT_ID=$(cat ...)` returned `curl: (7) Failed to connect to localhost port 3000`, while the same curl request with the literal project ID succeeded immediately.
- **Evidence:** Project and environment creation attempts during Task 5.
- **Impact:** Not an application blocker. Deferred to a follow-up because a robust scripted drill harness is outside Phase 6A.

### Finding 7: Source Map CLI Examples Pass A Literal `--`

- **Class:** Release friction candidate
- **Expected:** The documented `pnpm source-maps:upload -- --endpoint ...` style should invoke the source-map uploader successfully.
- **Actual:** The CLI received the extra `--` as an argument and failed with `Unknown option`.
- **Evidence:** `pnpm source-maps:upload -- --endpoint http://localhost:3000 ...`
- **Impact:** Not a product blocker because the upload succeeded with environment variables and no extra `--`. Fixed by removing the extra separator from source-map upload examples.

### Finding 8: Host pnpm Config Pointed The Trial Checkout At Another Repo's Virtual Store

- **Class:** Release friction candidate
- **Expected:** `pnpm install` in the disposable trial checkout should create a self-contained `node_modules/.pnpm` virtual store.
- **Actual:** The trial checkout's dependency symlinks pointed to `/Users/diogo/Developer/Github/social_media_agency/node_modules/.pnpm`; `pnpm run doctor -- --compose --api-url http://localhost:3000` initially failed with `Cannot find module '/private/tmp/signalhub-phase6a-rc/node_modules/tsx/dist/cli.mjs'`.
- **Evidence:** `pnpm config list` reported `virtual-store-dir=/Users/diogo/Developer/Github/social_media_agency/node_modules/.pnpm`; `readlink /private/tmp/signalhub-phase6a-rc/node_modules/tsx`; post-restore doctor succeeded after `rm -rf node_modules` and `pnpm install --config.virtual-store-dir=node_modules/.pnpm`.
- **Impact:** Not an application runtime blocker. Fixed by adding a repo-local pnpm virtual store override.

## Fixes Made

### Fix 1: Clarified The Node.js Release Baseline

- **Finding:** Finding 1
- **Files changed:** `README.md`, `.claude/docs/STACK.md`
- **Verification:** Documentation now states that Node.js 22.x is the supported release baseline while newer Node.js versions may work for local drills.

### Fix 2: Made pnpm Installs Self-Contained And Lockfile-Stable

- **Finding:** Findings 2 and 8
- **Files changed:** `.npmrc`, `pnpm-lock.yaml`
- **Verification:** `pnpm config get virtual-store-dir` now returns `node_modules/.pnpm`; `pnpm install` reports `Lockfile is up to date` and leaves the checkout with only intentional changes.

### Fix 3: Removed The Misleading Compose Source-Map Directory Warning

- **Finding:** Finding 4
- **Files changed:** `scripts/doctor.ts`, `scripts/doctor.test.ts`
- **Verification:** `pnpm exec vitest scripts/doctor.test.ts --run`; `COMPOSE_PROJECT_NAME=signalhub_phase6a_rc pnpm run doctor -- --compose --api-url http://localhost:3000 --env-file /private/tmp/signalhub-phase6a-rc/.env`

### Fix 4: Escaped The Phase 6A Admin Email Replacement Command

- **Finding:** Finding 5
- **Files changed:** `docs/superpowers/plans/2026-05-15-phase6a-release-candidate-install-trial-implementation.md`
- **Verification:** Applying the corrected `perl -0pi` command to a temporary `.env.example` copy produced `BOOTSTRAP_ADMIN_EMAIL=phase6a-admin@example.com` with no remaining placeholder secrets.

### Fix 5: Removed The Extra Source-Map Upload Argument Separator

- **Finding:** Finding 7
- **Files changed:** `README.md`, `docs/superpowers/plans/2026-05-15-phase6a-release-candidate-install-trial-implementation.md`
- **Verification:** `pnpm exec vitest packages/cli/test/source-maps.test.ts --run`; `pnpm source-maps:upload --file /private/tmp/signalhub-phase6a-app.min.js.map --minified-file app.min.js` with the Phase 6A environment variables uploaded one artifact for release `web@phase6a-rerun`.

## Follow-Ups

### Follow-Up 1: Reduce Optional Native Binding Noise During Docker Builds

- **Finding:** Finding 3
- **Reason deferred:** The image built and seeded successfully; reducing optional `cpu-features`/`ssh2` native binding warnings needs dependency or image strategy evaluation beyond the narrow install-path fixes.
- **Suggested next phase:** Phase 6B or later

### Follow-Up 2: Harden The Manual Drill Harness Against Brittle Shell State

- **Finding:** Finding 6
- **Reason deferred:** Making the chained curl examples robust points toward a scripted smoke harness, which the Phase 6A design explicitly deferred.
- **Suggested next phase:** Phase 6B or later

## Final Recommendation

Phase 6A passed. The fresh-install RC drill completed with no release blockers, targeted install-path fixes were applied and verified, and the final verification suite passed. Phase 6B should plan the deferred automated smoke harness and evaluate whether Docker build optional native binding noise can be reduced.
