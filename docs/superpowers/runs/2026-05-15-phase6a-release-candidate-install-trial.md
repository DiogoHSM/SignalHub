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

### Finding 3: Docker Build Emits Optional Native Binding Warnings

- **Class:** Release friction candidate
- **Expected:** The documented Compose build path should avoid alarming install output where practical.
- **Actual:** The API image build completed, but optional native bindings for `cpu-features` and `ssh2` emitted compiler/Python warnings inside `pnpm install --frozen-lockfile`.
- **Evidence:** `docker compose -p signalhub_phase6a_rc run --rm api pnpm seed:admin`
- **Impact:** Not a blocker because the image built and the admin seed succeeded. Classify during Task 9 as possible documentation note or Docker image dependency follow-up.

### Finding 4: Host-Side Doctor Warns About Container Source Map Directory

- **Class:** Release friction candidate
- **Expected:** Compose-aware doctor should be easy to interpret after the stack is running.
- **Actual:** `pnpm run doctor -- --compose --api-url http://localhost:3000` exited 0 and all running-service checks passed, but still warned that `SOURCE_MAPS_LOCAL_DIR` is missing or not writable on the host.
- **Evidence:** `pnpm run doctor -- --compose --api-url http://localhost:3000`
- **Impact:** Not a blocker. Classify during Task 9; likely a doctor message precision issue because Compose mounts `source_map_data` inside the API container.

### Finding 5: Planned Admin Email Replacement Did Not Apply

- **Class:** Release friction candidate
- **Expected:** The Task 3 `.env` replacement command should change `BOOTSTRAP_ADMIN_EMAIL` to `phase6a-admin@example.com`.
- **Actual:** `.env` kept `BOOTSTRAP_ADMIN_EMAIL=admin@example.com`, so login with `phase6a-admin@example.com` returned HTTP 401 while login with `admin@example.com` succeeded.
- **Evidence:** `rg -n "BOOTSTRAP_ADMIN_EMAIL" /private/tmp/signalhub-phase6a-rc/.env`; `curl ... /auth/login`; database user query.
- **Impact:** Not a product runtime blocker. Classify during Task 9 as a plan/docs command issue caused by the unescaped `@` in the Perl expression.

### Finding 6: Chained Shell Commands With Runtime Variables Were Brittle In The Drill Harness

- **Class:** Release friction candidate
- **Expected:** The scripted curl examples using command substitution should be reliable enough to follow during the drill.
- **Actual:** Chained shell commands using `PROJECT_ID=$(cat ...)` returned `curl: (7) Failed to connect to localhost port 3000`, while the same curl request with the literal project ID succeeded immediately.
- **Evidence:** Project and environment creation attempts during Task 5.
- **Impact:** Not an application blocker. Continue with literal IDs for the manual drill and classify during Task 9 as a plan-command robustness issue.

## Fixes Made

No fixes made yet.

## Follow-Ups

No follow-ups recorded yet.

## Final Recommendation

Pending completion of the drill.
