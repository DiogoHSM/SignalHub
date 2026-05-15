# Phase 6A Release Candidate Install Trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run and document a fresh Docker Compose release-candidate install trial, fixing only the install-path blockers and friction discovered by the drill.

**Architecture:** This phase adds no new product subsystem by default. It creates a durable RC drill record, executes the documented operator flow in an isolated checkout with fresh Compose volumes, records evidence and findings, then applies narrow documentation/script/API/console fixes only when the drill proves they are needed.

**Tech Stack:** pnpm 9.15.x, Node.js 22, TypeScript, Docker Compose, Fastify API, BullMQ worker, Postgres 16, Redis 7, Vite/React console, curl, Playwright/browser verification when console behavior cannot be proven through HTTP.

---

## Scope Check

The approved spec is one scoped release-readiness drill. It touches multiple runtime areas only as smoke-test surfaces, not as independent feature builds. Keep the implementation as one plan because every task contributes to the same release-candidate evidence trail.

Do not build the deferred automated smoke script in this phase. When the drill reveals a larger improvement, record it as a follow-up in the RC drill record instead of implementing it here.

## File Structure

- Create: `docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md`
  - Responsibility: permanent evidence record for the manual RC drill, including commands, outcomes, findings, fixes, and final recommendation.
- Modify if proven by the drill: `README.md`
  - Responsibility: public operator install, doctor, bootstrap, ingestion, backup, restore, and troubleshooting guidance.
- Modify if proven by the drill: `.env.example`
  - Responsibility: safe default config and complete operator environment reference.
- Modify if proven by the drill: `docs/HTTP-INGESTION.md`
  - Responsibility: raw HTTP ingestion examples used by operators.
- Modify if proven by the drill: `.claude/docs/DEPLOYMENT.md`
  - Responsibility: project-local deployment workflow and release verification notes.
- Modify if proven by the drill: `.claude/docs/INFRASTRUCTURE.md`
  - Responsibility: services, storage, operational checks, and runtime topology notes.
- Modify if proven by the drill: `.claude/docs/SECRETS.md`
  - Responsibility: sanitized environment variable and secret handling documentation.
- Modify if proven by the drill: `.claude/docs/STACK.md`
  - Responsibility: commands, package scripts, and toolchain notes.
- Modify if proven by the drill: `.claude/docs/PROJECT-SUMMARY.md`
  - Responsibility: current phase and implemented release-readiness capability summary.
- Modify if proven by the drill: `.claude/docs/CONSTRAINTS.md`
  - Responsibility: release-line constraints and deferred deployment support.
- Modify if proven by the drill: `scripts/doctor.ts`, `scripts/doctor.test.ts`
  - Responsibility: read-only install diagnostics and targeted doctor output corrections.
- Modify if proven by the drill: `scripts/backup-create.ts`, `scripts/backup-restore.ts`, related tests
  - Responsibility: manual backup/restore command friction exposed during the drill.
- Modify if proven by the drill: `apps/api/src/**`, `apps/api/test/**`
  - Responsibility: small API defects that block fresh install, ingestion, source-map upload, querying, health, readiness, or system health checks.
- Modify if proven by the drill: `apps/console/src/**`
  - Responsibility: small console defects that block login, setup, investigation, Artifacts, or System verification.
- Modify after execution: `CLAUDE.md`
  - Responsibility: update current phase and project conventions only if the drill changes durable workflow knowledge.
- Modify after execution: `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`
  - Responsibility: record final Phase 6A outcome and resume point.

## Task 1: Create The RC Drill Record Skeleton

**Files:**
- Create: `docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md`

- [ ] **Step 1: Create the run-record directory**

Run:

```sh
mkdir -p docs/superpowers/runs
```

Expected: command exits `0`.

- [ ] **Step 2: Add the run-record skeleton**

Use `apply_patch` to create `docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md` with exactly this structure:

```markdown
# Phase 6A Release Candidate Install Trial Run

## Summary

- **Status:** In progress
- **Commit under test:** `pending`
- **Trial checkout:** `pending`
- **Compose project:** `signalhub_phase6a_rc`
- **API URL:** `http://localhost:3000`
- **Console URL:** `http://localhost:3000/console`
- **Started:** `pending`
- **Completed:** `pending`
- **Final recommendation:** `pending`

## Environment

| Item | Value |
| --- | --- |
| Host OS | `pending` |
| Node.js | `pending` |
| pnpm | `pending` |
| Docker | `pending` |
| Docker Compose | `pending` |
| Trial checkout path | `pending` |
| Fresh volumes confirmed | `pending` |

## Command Log

| Step | Command | Expected | Actual | Result |
| --- | --- | --- | --- | --- |

## Drill Results

| Step | Result | Evidence |
| --- | --- | --- |
| Clean checkout prepared | pending | pending |
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

No findings recorded yet.

## Fixes Made

No fixes made yet.

## Follow-Ups

No follow-ups recorded yet.

## Final Recommendation

Pending completion of the drill.
```

- [ ] **Step 3: Verify the skeleton has no unresolved template labels except intentional `pending` cells**

Run:

```sh
rg -n "TBD|TODO|FIXME|YOUR_|PLACEHOLDER" docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md
```

Expected: command exits `1` with no matches.

- [ ] **Step 4: Commit the skeleton**

Run:

```sh
git add docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md
git commit -m "docs: start phase 6a rc drill record"
```

Expected: commit succeeds.

## Task 2: Prepare The Isolated Fresh-Install Trial Checkout

**Files:**
- Modify: `docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md`

- [ ] **Step 1: Capture the commit under test**

Run:

```sh
git rev-parse --short HEAD
```

Expected: prints the commit that includes the RC drill record skeleton.

- [ ] **Step 2: Create a local throwaway checkout**

Run:

```sh
rm -rf /private/tmp/signalhub-phase6a-rc
git clone /Users/diogo/Developer/Github/SignalHub /private/tmp/signalhub-phase6a-rc
```

Expected: local clone succeeds without using the network.

- [ ] **Step 3: Inspect the fresh checkout state**

Run:

```sh
git -C /private/tmp/signalhub-phase6a-rc status -sb
git -C /private/tmp/signalhub-phase6a-rc rev-parse --short HEAD
```

Expected: status shows a clean branch and the same commit captured in Step 1.

- [ ] **Step 4: Capture host tool versions**

Run:

```sh
node --version
pnpm --version
docker --version
docker compose version
```

Expected: Node.js is version `22.x`, pnpm is `9.15.x`, Docker and Docker Compose print versions.

- [ ] **Step 5: Update the run record environment section**

Use `apply_patch` in the main workspace to replace the initial `pending` values for commit, trial checkout, started time, host OS, Node.js, pnpm, Docker, Docker Compose, checkout path, and fresh-volume status.

Use this value format, replacing `SHORT_SHA_FROM_STEP_1` with the actual short commit printed in Step 1:

```markdown
- **Commit under test:** `SHORT_SHA_FROM_STEP_1`
- **Trial checkout:** `/private/tmp/signalhub-phase6a-rc`
- **Started:** `YYYY-MM-DD HH:MM America/Sao_Paulo`
```

For fresh volumes, set:

```markdown
| Fresh volumes confirmed | `not yet` |
```

- [ ] **Step 6: Commit the environment evidence**

Run:

```sh
git add docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md
git commit -m "docs: record phase 6a trial environment"
```

Expected: commit succeeds.

## Task 3: Prepare `.env` And Run Pre-Start Diagnostics

**Files:**
- Modify: `docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md`

- [ ] **Step 1: Create the trial `.env`**

Run from the trial checkout:

```sh
cp .env.example .env
perl -0pi -e 's/signalhub-local-only-change-me/signalhub-phase6a-local-password-42/g; s/change-me-to-a-long-random-secret/phase6a-session-secret-000000000000000000000000/g; s/change-me-to-a-long-random-pepper/phase6a-api-key-pepper-000000000000000000000/g; s/change-me-admin-password-32-chars-min/phase6a-admin-password-00000000000000000000/g; s/admin@example.com/phase6a-admin@example.com/g' .env
```

Expected: `.env` exists in `/private/tmp/signalhub-phase6a-rc` with no production placeholder secrets.

- [ ] **Step 2: Verify no known placeholder values remain in the trial `.env`**

Run:

```sh
rg -n "change-me|signalhub-local-only-change-me" /private/tmp/signalhub-phase6a-rc/.env
```

Expected: command exits `1` with no matches.

- [ ] **Step 3: Install dependencies in the trial checkout**

Run:

```sh
pnpm install
```

Expected: dependency installation succeeds in `/private/tmp/signalhub-phase6a-rc`.

- [ ] **Step 4: Run pre-start doctor**

Run:

```sh
pnpm run doctor
```

Expected: exits `0`. Warnings are acceptable only when they are explicitly about services not running yet or local development endpoint choices.

- [ ] **Step 5: Render Compose config**

Run:

```sh
docker compose -p signalhub_phase6a_rc config --quiet
```

Expected: exits `0`.

- [ ] **Step 6: Update the run record**

Record Steps 1-5 in the `Command Log`, then set these `Drill Results` rows to `pass` or to a concrete `blocker` / `friction` classification:

```markdown
| `.env` prepared with non-placeholder secrets | pass | `rg` found no placeholder values in trial `.env`. |
| Pre-start doctor | pass | `pnpm run doctor` exited 0. |
| Compose config render | pass | `docker compose -p signalhub_phase6a_rc config --quiet` exited 0. |
```

- [ ] **Step 7: Commit the diagnostic evidence**

Run:

```sh
git add docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md
git commit -m "docs: record phase 6a pre-start diagnostics"
```

Expected: commit succeeds.

## Task 4: Start The Fresh Stack And Seed The Admin

**Files:**
- Modify: `docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md`

- [ ] **Step 1: Confirm the trial Compose project has no existing volumes**

Run:

```sh
docker volume ls --format '{{.Name}}' | rg '^signalhub_phase6a_rc_'
```

Expected: command exits `1` with no matches. If it prints matching volumes, stop the task and classify this as a release-drill environment blocker before removing anything.

- [ ] **Step 2: Start Postgres and Redis**

Run:

```sh
docker compose -p signalhub_phase6a_rc up -d postgres redis
```

Expected: Postgres and Redis start and become healthy.

- [ ] **Step 3: Seed the bootstrap admin**

Run:

```sh
docker compose -p signalhub_phase6a_rc run --rm api pnpm seed:admin
```

Expected: seed command exits `0` and reports the bootstrap admin was created or already exists.

- [ ] **Step 4: Start the full stack**

Run:

```sh
docker compose -p signalhub_phase6a_rc up -d --build
```

Expected: API and worker containers start successfully.

- [ ] **Step 5: Inspect service state**

Run:

```sh
docker compose -p signalhub_phase6a_rc ps
```

Expected: `postgres`, `redis`, `api`, and `worker` are running; Postgres and Redis are healthy.

- [ ] **Step 6: Run Compose-aware doctor**

Run:

```sh
pnpm run doctor -- --compose --api-url http://localhost:3000
```

Expected: exits `0`.

- [ ] **Step 7: Verify health and readiness**

Run:

```sh
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/ready
```

Expected: both commands exit `0`.

- [ ] **Step 8: Update the run record**

Set these rows based on the actual evidence:

```markdown
| Fresh volumes confirmed | `yes: no signalhub_phase6a_rc_* volumes existed before first start` |
| Dependencies started | pass | `docker compose -p signalhub_phase6a_rc up -d postgres redis` succeeded. |
| Bootstrap admin seeded | pass | `docker compose -p signalhub_phase6a_rc run --rm api pnpm seed:admin` exited 0. |
| Full stack started | pass | `docker compose -p signalhub_phase6a_rc ps` showed all services running. |
| Compose-aware doctor | pass | `pnpm run doctor -- --compose --api-url http://localhost:3000` exited 0. |
| Health and readiness | pass | `/health` and `/ready` returned success. |
```

- [ ] **Step 9: Commit stack startup evidence**

Run:

```sh
git add docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md
git commit -m "docs: record phase 6a stack startup"
```

Expected: commit succeeds.

## Task 5: Create Admin Session, Project, Environment, And API Keys

**Files:**
- Modify: `docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md`

- [ ] **Step 1: Log in through HTTP and save a cookie jar**

Run:

```sh
curl -fsS -c /private/tmp/signalhub-phase6a-cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"email":"phase6a-admin@example.com","password":"phase6a-admin-password-00000000000000000000"}' \
  http://localhost:3000/auth/login
```

Expected: exits `0` and returns the admin session user.

- [ ] **Step 2: Verify the session**

Run:

```sh
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt http://localhost:3000/auth/me
```

Expected: returns `phase6a-admin@example.com`.

- [ ] **Step 3: Create the RC project**

Run:

```sh
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"name":"Phase 6A RC Project"}' \
  http://localhost:3000/admin/projects \
  > /private/tmp/signalhub-phase6a-project.json
```

Expected: response includes a project ID.

- [ ] **Step 4: Extract the project ID**

Run:

```sh
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync("/private/tmp/signalhub-phase6a-project.json","utf8")); console.log(data.project.id);' \
  > /private/tmp/signalhub-phase6a-project-id.txt
```

Expected: `/private/tmp/signalhub-phase6a-project-id.txt` contains a `prj_...` value.

- [ ] **Step 5: Create the RC environment**

Run:

```sh
PROJECT_ID="$(cat /private/tmp/signalhub-phase6a-project-id.txt)"
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"name":"production"}' \
  "http://localhost:3000/admin/projects/${PROJECT_ID}/environments" \
  > /private/tmp/signalhub-phase6a-environment.json
```

Expected: response includes an environment ID.

- [ ] **Step 6: Extract the environment ID**

Run:

```sh
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync("/private/tmp/signalhub-phase6a-environment.json","utf8")); console.log(data.environment.id);' \
  > /private/tmp/signalhub-phase6a-environment-id.txt
```

Expected: `/private/tmp/signalhub-phase6a-environment-id.txt` contains an `env_...` value.

- [ ] **Step 7: Create an ingestion API key**

Run:

```sh
PROJECT_ID="$(cat /private/tmp/signalhub-phase6a-project-id.txt)"
ENVIRONMENT_ID="$(cat /private/tmp/signalhub-phase6a-environment-id.txt)"
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt \
  -H "Content-Type: application/json" \
  -d "{\"environmentId\":\"${ENVIRONMENT_ID}\",\"name\":\"Phase 6A ingest\"}" \
  "http://localhost:3000/admin/projects/${PROJECT_ID}/api-keys" \
  > /private/tmp/signalhub-phase6a-api-key.json
```

Expected: response includes a one-time API key secret.

- [ ] **Step 8: Extract the ingestion secret**

Run:

```sh
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync("/private/tmp/signalhub-phase6a-api-key.json","utf8")); console.log(data.apiKey.secret);' \
  > /private/tmp/signalhub-phase6a-api-key-secret.txt
chmod 600 /private/tmp/signalhub-phase6a-api-key-secret.txt
```

Expected: file contains an `sh_...` ingestion secret and is readable only by the owner.

- [ ] **Step 9: Update and commit the run record**

Record the project and environment IDs, not the API key secret. Set:

```markdown
| Console login | pass | HTTP login and `/auth/me` succeeded for `phase6a-admin@example.com`. |
| Project/environment/API key setup | pass | Created RC project, `production` environment, and one ingestion API key; secret was stored only in `/private/tmp`. |
```

Run:

```sh
git add docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md
git commit -m "docs: record phase 6a setup smoke"
```

Expected: commit succeeds and no secret value is committed.

## Task 6: Ingest And Query Core Telemetry

**Files:**
- Modify: `docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md`

- [ ] **Step 1: Ingest one event**

Run:

```sh
API_KEY="$(cat /private/tmp/signalhub-phase6a-api-key-secret.txt)"
curl -fsS \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"name":"phase6a.account.created","tenant_id":"tenant_phase6a","user_id":"user_phase6a","session_id":"sess_phase6a","source":"rc-drill","release":"web@phase6a","properties":{"plan":"trial"},"metadata":{"drill":"phase6a"}}' \
  http://localhost:3000/v1/events
```

Expected: response includes `"accepted":true`.

- [ ] **Step 2: Ingest one grouped browser-style error**

Run:

```sh
API_KEY="$(cat /private/tmp/signalhub-phase6a-api-key-secret.txt)"
curl -fsS \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"message":"Phase 6A checkout failed","type":"Phase6ACheckoutError","severity":"error","tenant_id":"tenant_phase6a","user_id":"user_phase6a","session_id":"sess_phase6a","trace_id":"trace_phase6a","source":"browser","release":"web@phase6a","fingerprint":"phase6a-checkout-error","stack":"Phase6ACheckoutError: checkout failed\n    at checkout (https://cdn.example.com/assets/app.min.js:1:5)","context":{"route":"/checkout"},"metadata":{"drill":"phase6a"}}' \
  http://localhost:3000/v1/errors
```

Expected: response includes `"accepted":true`.

- [ ] **Step 3: Ingest one trace**

Run:

```sh
API_KEY="$(cat /private/tmp/signalhub-phase6a-api-key-secret.txt)"
curl -fsS \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"name":"phase6a.checkout","status":"success","started_at":"2026-05-15T12:00:00.000Z","ended_at":"2026-05-15T12:00:02.400Z","duration_ms":2400,"tenant_id":"tenant_phase6a","user_id":"user_phase6a","session_id":"sess_phase6a","trace_id":"trace_phase6a","source":"rc-drill","release":"web@phase6a","metadata":{"drill":"phase6a"}}' \
  http://localhost:3000/v1/traces
```

Expected: response includes `"accepted":true`.

- [ ] **Step 4: Ingest one span**

Run:

```sh
API_KEY="$(cat /private/tmp/signalhub-phase6a-api-key-secret.txt)"
curl -fsS \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"trace_id":"trace_phase6a","name":"phase6a.db.query","status":"success","started_at":"2026-05-15T12:00:00.200Z","ended_at":"2026-05-15T12:00:00.420Z","duration_ms":220,"tenant_id":"tenant_phase6a","user_id":"user_phase6a","session_id":"sess_phase6a","input":{"table":"orders"},"output":{"row_count":1},"metadata":{"drill":"phase6a"}}' \
  http://localhost:3000/v1/spans
```

Expected: response includes `"accepted":true`.

- [ ] **Step 5: Ingest one LLM call**

Run:

```sh
API_KEY="$(cat /private/tmp/signalhub-phase6a-api-key-secret.txt)"
curl -fsS \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"gpt-5-mini","prompt_name":"phase6a_summary","input_tokens":120,"output_tokens":64,"cost_usd":0.0042,"latency_ms":840,"status":"success","tenant_id":"tenant_phase6a","user_id":"user_phase6a","session_id":"sess_phase6a","trace_id":"trace_phase6a","source":"rc-drill","release":"web@phase6a","metadata":{"drill":"phase6a"}}' \
  http://localhost:3000/v1/llm
```

Expected: response includes `"accepted":true`.

- [ ] **Step 6: Ingest one breadcrumb**

Run:

```sh
API_KEY="$(cat /private/tmp/signalhub-phase6a-api-key-secret.txt)"
curl -fsS \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"type":"custom","category":"checkout","message":"Phase 6A selected shipping method","level":"info","tenant_id":"tenant_phase6a","user_id":"user_phase6a","session_id":"sess_phase6a","trace_id":"trace_phase6a","source":"browser","release":"web@phase6a","data":{"method":"standard"},"metadata":{"drill":"phase6a"}}' \
  http://localhost:3000/v1/breadcrumbs
```

Expected: response includes `"accepted":true`.

- [ ] **Step 7: Wait for worker persistence**

Run:

```sh
sleep 5
```

Expected: command exits `0`.

- [ ] **Step 8: Query core telemetry**

Run:

```sh
PROJECT_ID="$(cat /private/tmp/signalhub-phase6a-project-id.txt)"
ENVIRONMENT_ID="$(cat /private/tmp/signalhub-phase6a-environment-id.txt)"
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt "http://localhost:3000/query/events?project_id=${PROJECT_ID}&environment_id=${ENVIRONMENT_ID}&event_name=phase6a.account.created&limit=5" > /private/tmp/signalhub-phase6a-query-events.json
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt "http://localhost:3000/query/errors?project_id=${PROJECT_ID}&environment_id=${ENVIRONMENT_ID}&fingerprint=phase6a-checkout-error&limit=5" > /private/tmp/signalhub-phase6a-query-errors.json
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt "http://localhost:3000/query/error-groups?project_id=${PROJECT_ID}&environment_id=${ENVIRONMENT_ID}&fingerprint=phase6a-checkout-error&limit=5" > /private/tmp/signalhub-phase6a-query-error-groups.json
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt "http://localhost:3000/query/traces?project_id=${PROJECT_ID}&environment_id=${ENVIRONMENT_ID}&trace_id=trace_phase6a&limit=5" > /private/tmp/signalhub-phase6a-query-traces.json
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt "http://localhost:3000/query/traces/trace_phase6a/spans?project_id=${PROJECT_ID}&environment_id=${ENVIRONMENT_ID}" > /private/tmp/signalhub-phase6a-query-spans.json
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt "http://localhost:3000/query/llm-calls?project_id=${PROJECT_ID}&environment_id=${ENVIRONMENT_ID}&trace_id=trace_phase6a&limit=5" > /private/tmp/signalhub-phase6a-query-llm.json
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt "http://localhost:3000/query/aggregates/llm?project_id=${PROJECT_ID}&environment_id=${ENVIRONMENT_ID}" > /private/tmp/signalhub-phase6a-query-llm-aggregate.json
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt "http://localhost:3000/query/entities/tenants?project_id=${PROJECT_ID}&environment_id=${ENVIRONMENT_ID}&limit=5" > /private/tmp/signalhub-phase6a-query-tenants.json
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt "http://localhost:3000/query/users?project_id=${PROJECT_ID}&environment_id=${ENVIRONMENT_ID}&limit=5" > /private/tmp/signalhub-phase6a-query-users.json
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt "http://localhost:3000/query/sessions/sess_phase6a/timeline?project_id=${PROJECT_ID}&environment_id=${ENVIRONMENT_ID}&limit=25" > /private/tmp/signalhub-phase6a-query-session-timeline.json
```

Expected: every query exits `0` and the JSON files contain the `phase6a` smoke data.

- [ ] **Step 9: Verify queried smoke data with Node**

Run:

```sh
node -e '
const fs = require("fs");
const checks = [
  ["/private/tmp/signalhub-phase6a-query-events.json", "phase6a.account.created"],
  ["/private/tmp/signalhub-phase6a-query-errors.json", "Phase 6A checkout failed"],
  ["/private/tmp/signalhub-phase6a-query-error-groups.json", "phase6a-checkout-error"],
  ["/private/tmp/signalhub-phase6a-query-traces.json", "phase6a.checkout"],
  ["/private/tmp/signalhub-phase6a-query-spans.json", "phase6a.db.query"],
  ["/private/tmp/signalhub-phase6a-query-llm.json", "phase6a_summary"],
  ["/private/tmp/signalhub-phase6a-query-llm-aggregate.json", "0.0042"],
  ["/private/tmp/signalhub-phase6a-query-tenants.json", "tenant_phase6a"],
  ["/private/tmp/signalhub-phase6a-query-users.json", "user_phase6a"],
  ["/private/tmp/signalhub-phase6a-query-session-timeline.json", "Phase 6A selected shipping method"]
];
for (const [file, needle] of checks) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(needle)) {
    throw new Error(`${file} did not include ${needle}`);
  }
}
console.log("phase6a telemetry queries verified");
'
```

Expected: prints `phase6a telemetry queries verified`.

- [ ] **Step 10: Update and commit the run record**

Set these rows:

```markdown
| Event ingestion and query | pass | Event accepted and `/query/events` returned `phase6a.account.created`. |
| Error ingestion, grouping, and raw drilldown | pass | Error accepted and `/query/errors` plus `/query/error-groups` returned `phase6a-checkout-error`. |
| Trace/span ingestion and query | pass | Trace and span accepted and query endpoints returned `trace_phase6a`. |
| LLM ingestion and aggregate query | pass | LLM call accepted; `/query/llm-calls` returned `phase6a_summary` and `/query/aggregates/llm` reflected the smoke cost. |
| Breadcrumb ingestion and error session context | pass | Breadcrumb accepted and `/query/sessions/sess_phase6a/timeline` returned `Phase 6A selected shipping method`. |
| Entities and Users visibility | pass | Tenant and user query surfaces returned `tenant_phase6a` and `user_phase6a`. |
```

Run:

```sh
git add docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md
git commit -m "docs: record phase 6a telemetry smoke"
```

Expected: commit succeeds.

## Task 7: Verify Console And Source-Map Smoke

**Files:**
- Modify: `docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md`

- [ ] **Step 1: Open the console in a browser**

Use the Browser plugin or Playwright wrapper to navigate to:

```txt
http://localhost:3000/console
```

Expected: login screen renders without browser console errors.

- [ ] **Step 2: Log in through the console**

Use:

```txt
email: phase6a-admin@example.com
password: phase6a-admin-password-00000000000000000000
```

Expected: console shows the authenticated operational UI.

- [ ] **Step 3: Confirm primary console surfaces**

In the console, confirm the active project/environment can show:

```txt
Overview
Investigate > Events
Investigate > Errors
Investigate > Traces
Investigate > LLM
Investigate > Entities
Investigate > Users
Artifacts
System
```

Expected: each surface loads without an unrecoverable error and the smoke data appears where applicable.

- [ ] **Step 4: Create a source-map upload token through HTTP**

Run:

```sh
PROJECT_ID="$(cat /private/tmp/signalhub-phase6a-project-id.txt)"
ENVIRONMENT_ID="$(cat /private/tmp/signalhub-phase6a-environment-id.txt)"
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"${PROJECT_ID}\",\"environmentId\":\"${ENVIRONMENT_ID}\",\"name\":\"Phase 6A source map upload\"}" \
  http://localhost:3000/admin/source-map-upload-tokens \
  > /private/tmp/signalhub-phase6a-source-map-token.json
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync("/private/tmp/signalhub-phase6a-source-map-token.json","utf8")); console.log(data.token.secret);' \
  > /private/tmp/signalhub-phase6a-source-map-token-secret.txt
chmod 600 /private/tmp/signalhub-phase6a-source-map-token-secret.txt
```

Expected: response includes a one-time `shsmap_...` secret and the secret is stored only under `/private/tmp`.

- [ ] **Step 5: Create a deterministic source map fixture**

Run:

```sh
cat > /private/tmp/signalhub-phase6a-app.min.js.map <<'EOF'
{"version":3,"file":"app.min.js","sources":["src/app.ts"],"names":["checkout"],"mappings":"IAyCIA","sourcesContent":["export function checkout() { throw new Error('Phase 6A checkout failed'); }\n"]}
EOF
```

Expected: source map file exists and has `file` set to `app.min.js`.

- [ ] **Step 6: Upload the source map with the CLI**

Run:

```sh
SOURCE_MAP_TOKEN="$(cat /private/tmp/signalhub-phase6a-source-map-token-secret.txt)"
PROJECT_ID="$(cat /private/tmp/signalhub-phase6a-project-id.txt)"
ENVIRONMENT_ID="$(cat /private/tmp/signalhub-phase6a-environment-id.txt)"
pnpm source-maps:upload -- \
  --endpoint http://localhost:3000 \
  --token "${SOURCE_MAP_TOKEN}" \
  --project-id "${PROJECT_ID}" \
  --environment-id "${ENVIRONMENT_ID}" \
  --release web@phase6a \
  --file /private/tmp/signalhub-phase6a-app.min.js.map \
  --minified-file app.min.js
```

Expected: exits `0` and reports `Uploaded 1 source map artifact(s)`.

- [ ] **Step 7: Query errors again and extract an error ID**

Run:

```sh
PROJECT_ID="$(cat /private/tmp/signalhub-phase6a-project-id.txt)"
ENVIRONMENT_ID="$(cat /private/tmp/signalhub-phase6a-environment-id.txt)"
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt "http://localhost:3000/query/errors?project_id=${PROJECT_ID}&environment_id=${ENVIRONMENT_ID}&fingerprint=phase6a-checkout-error&limit=5" \
  > /private/tmp/signalhub-phase6a-query-errors-after-sourcemap.json
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync("/private/tmp/signalhub-phase6a-query-errors-after-sourcemap.json","utf8")); const first = data.data?.[0] ?? data.errors?.[0] ?? data.items?.[0]; if (!first?.id) throw new Error("No error id found"); console.log(first.id);' \
  > /private/tmp/signalhub-phase6a-error-id.txt
```

Expected: an error ID is written to `/private/tmp/signalhub-phase6a-error-id.txt`.

- [ ] **Step 8: Request source-map resolution metadata**

Run:

```sh
PROJECT_ID="$(cat /private/tmp/signalhub-phase6a-project-id.txt)"
ENVIRONMENT_ID="$(cat /private/tmp/signalhub-phase6a-environment-id.txt)"
ERROR_ID="$(cat /private/tmp/signalhub-phase6a-error-id.txt)"
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt "http://localhost:3000/query/errors/${ERROR_ID}/source-map-resolution?project_id=${PROJECT_ID}&environment_id=${ENVIRONMENT_ID}" \
  > /private/tmp/signalhub-phase6a-source-map-resolution.json
node -e 'const fs=require("fs"); const text=fs.readFileSync("/private/tmp/signalhub-phase6a-source-map-resolution.json","utf8"); if (!text.includes("src/app.ts")) throw new Error("source map resolution did not include src/app.ts"); console.log("source map resolution verified");'
```

Expected: prints `source map resolution verified`.

- [ ] **Step 9: Verify System health JSON**

Run:

```sh
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt http://localhost:3000/system/health \
  > /private/tmp/signalhub-phase6a-system-health.json
node -e 'const fs=require("fs"); const text=fs.readFileSync("/private/tmp/signalhub-phase6a-system-health.json","utf8"); for (const needle of ["retention","backup","sourceMaps"]) { if (!text.includes(needle)) throw new Error(`system health missing ${needle}`); } console.log("system health verified");'
```

Expected: prints `system health verified`.

- [ ] **Step 10: Update and commit the run record**

Set these rows:

```markdown
| Console login | pass | Browser login succeeded and authenticated console loaded. |
| Breadcrumb ingestion and error session context | pass | API session timeline returned the breadcrumb and console raw error detail showed session-linked context. |
| Source-map token creation | pass | Created upload token; secret stored only under `/private/tmp`. |
| Source-map upload | pass | CLI uploaded `app.min.js.map` for `web@phase6a`. |
| Source-map resolution | pass | Resolution metadata included `src/app.ts`. |
| System health visibility | pass | `/system/health` included retention, source-map, and backup status. |
```

Run:

```sh
git add docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md
git commit -m "docs: record phase 6a console and source map smoke"
```

Expected: commit succeeds.

## Task 8: Run Backup, Guarded Restore, And Post-Restore Smoke

**Files:**
- Modify: `docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md`

- [ ] **Step 1: Run a manual backup**

Run:

```sh
docker compose -p signalhub_phase6a_rc run --rm worker pnpm backup:create
```

Expected: exits `0` and reports a backup file path under `/var/lib/signalhub/backups`.

- [ ] **Step 2: Find the newest backup dump inside the worker volume**

Run:

```sh
docker compose -p signalhub_phase6a_rc run --rm worker sh -lc 'ls -1t /var/lib/signalhub/backups/*.dump | head -n 1' \
  > /private/tmp/signalhub-phase6a-backup-path.txt
```

Expected: file contains a path like `/var/lib/signalhub/backups/signalhub-YYYYMMDDTHHMMSSZ.dump`.

- [ ] **Step 3: Stop API and worker**

Run:

```sh
docker compose -p signalhub_phase6a_rc stop api worker
```

Expected: API and worker stop cleanly.

- [ ] **Step 4: Verify guarded restore refuses to run without `--yes`**

Run:

```sh
BACKUP_PATH="$(cat /private/tmp/signalhub-phase6a-backup-path.txt)"
docker compose -p signalhub_phase6a_rc run --rm worker pnpm backup:restore -- "${BACKUP_PATH}"
```

Expected: command exits non-zero and prints a confirmation-required message. Record the non-zero outcome as a pass for the guard check.

- [ ] **Step 5: Run the confirmed restore**

Run:

```sh
BACKUP_PATH="$(cat /private/tmp/signalhub-phase6a-backup-path.txt)"
docker compose -p signalhub_phase6a_rc run --rm worker pnpm backup:restore -- "${BACKUP_PATH}" --yes
```

Expected: exits `0`.

- [ ] **Step 6: Restart API and worker**

Run:

```sh
docker compose -p signalhub_phase6a_rc start api worker
```

Expected: API and worker start.

- [ ] **Step 7: Run post-restore doctor and health checks**

Run:

```sh
pnpm run doctor -- --compose --api-url http://localhost:3000
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/ready
```

Expected: all commands exit `0`.

- [ ] **Step 8: Re-run a small telemetry query**

Run:

```sh
PROJECT_ID="$(cat /private/tmp/signalhub-phase6a-project-id.txt)"
ENVIRONMENT_ID="$(cat /private/tmp/signalhub-phase6a-environment-id.txt)"
curl -fsS -b /private/tmp/signalhub-phase6a-cookies.txt "http://localhost:3000/query/events?project_id=${PROJECT_ID}&environment_id=${ENVIRONMENT_ID}&event_name=phase6a.account.created&limit=5" \
  > /private/tmp/signalhub-phase6a-post-restore-events.json
node -e 'const fs=require("fs"); const text=fs.readFileSync("/private/tmp/signalhub-phase6a-post-restore-events.json","utf8"); if (!text.includes("phase6a.account.created")) throw new Error("post-restore event query missing smoke event"); console.log("post-restore telemetry verified");'
```

Expected: prints `post-restore telemetry verified`.

- [ ] **Step 9: Update and commit the run record**

Set these rows:

```markdown
| Manual backup | pass | `docker compose -p signalhub_phase6a_rc run --rm worker pnpm backup:create` created a dump. |
| Guarded restore | pass | Restore refused to run without `--yes`, then restored successfully with `--yes` while API/worker were stopped. |
| Post-restore smoke | pass | Doctor, health, readiness, and event query succeeded after restore. |
```

Run:

```sh
git add docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md
git commit -m "docs: record phase 6a backup restore smoke"
```

Expected: commit succeeds.

## Task 9: Classify Findings And Apply Targeted Fixes

**Files:**
- Modify: files listed in the File Structure section only when a recorded finding proves the change is required
- Modify: `docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md`

- [ ] **Step 1: Review the run record for non-pass rows**

Run:

```sh
rg -n "blocker|friction|follow-up|failed|error|warn" docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md
```

Expected: prints any findings that need classification, or exits `1` if the drill was clean.

- [ ] **Step 2: For every release blocker, invoke systematic debugging before editing**

For each release blocker, use `superpowers:systematic-debugging` and capture:

```markdown
### Finding N: concise finding title

- **Class:** Release blocker
- **Expected:** one sentence describing the expected release-path behavior
- **Actual:** one sentence describing the actual behavior
- **Evidence:** `exact command or browser step`
- **Root cause:** confirmed root cause
- **Fix:** specific file and behavior changed
- **Verification:** `exact command or browser step that now passes`
```

Expected: each blocker has a confirmed root cause before code changes.

- [ ] **Step 3: For every release friction item, decide whether it is a small local fix**

Use this exact rule:

```markdown
- Fix now when the change is documentation, `.env.example`, doctor output, a script argument/order bug, or a small API/console defect that blocks the documented drill.
- Record as follow-up when the change adds automation, a new product surface, a new deploy target, release publishing, object storage, or broad refactoring.
```

Expected: each friction item becomes either a fix in this phase or a follow-up in the run record.

- [ ] **Step 4: Apply each targeted fix with a failing check first**

For documentation fixes, the failing check is the command or drill step that was misleading. For code/script fixes, write or update the focused test before implementation.

Use one of these focused test commands before each code/script fix, choosing the command that matches the changed area:

```sh
pnpm exec vitest scripts/doctor.test.ts --run
pnpm exec vitest apps/api/test/admin.test.ts --run
pnpm exec vitest apps/api/test/query.test.ts --run
pnpm exec vitest apps/api/test/ingestion.test.ts --run
pnpm exec vitest packages/cli/test/source-maps.test.ts --run
pnpm exec vitest apps/console/src/components/ArtifactsPanel.test.tsx --run
```

Expected before implementation: focused test fails for the observed bug.

Then implement the smallest fix and re-run:

```sh
pnpm exec vitest scripts/doctor.test.ts --run
pnpm exec vitest apps/api/test/admin.test.ts --run
pnpm exec vitest apps/api/test/query.test.ts --run
pnpm exec vitest apps/api/test/ingestion.test.ts --run
pnpm exec vitest packages/cli/test/source-maps.test.ts --run
pnpm exec vitest apps/console/src/components/ArtifactsPanel.test.tsx --run
```

Expected after implementation: the focused test command that failed before the fix now passes. Running all listed commands is allowed when a fix crosses boundaries.

- [ ] **Step 5: Re-run the affected drill step**

Run the exact command or browser action that originally failed.

Expected: the affected RC drill step now passes.

- [ ] **Step 6: Update the run record**

Add each fix under `Fixes Made` with this format:

```markdown
### Fix N: concise fix title

- **Finding:** Finding N
- **Files changed:** `path/to/file`, `path/to/file`
- **Verification:** `exact command or browser action`
```

Add each deferred item under `Follow-Ups` with this format:

```markdown
### Follow-Up N: concise follow-up title

- **Reason deferred:** one sentence explaining why it is outside Phase 6A
- **Suggested next phase:** Phase 6B or later
```

Expected: no finding is left unclassified.

- [ ] **Step 7: Commit targeted fixes and run-record updates**

Run:

```sh
git status -sb
git add docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md README.md .env.example docs/HTTP-INGESTION.md .claude/docs CLAUDE.md scripts apps/api apps/console
git commit -m "fix: address phase 6a install trial findings"
```

Expected: commit succeeds when fixes were made. If there were no fixes, commit only the run-record classification with:

```sh
git add docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md
git commit -m "docs: classify phase 6a install trial findings"
```

## Task 10: Run Final Verification And Complete Documentation State

**Files:**
- Modify: `docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md`
- Modify: `CLAUDE.md` if durable project context changed
- Modify: `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`

- [ ] **Step 1: Run repo verification**

Run:

```sh
pnpm test
pnpm build
docker compose config --quiet
pnpm run doctor
```

Expected: all commands exit `0`.

- [ ] **Step 2: Run final Compose-aware verification against the trial stack**

Run:

```sh
pnpm run doctor -- --compose --api-url http://localhost:3000
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/ready
```

Expected: all commands exit `0`.

- [ ] **Step 3: Update final run-record status**

Set:

```markdown
- **Status:** Complete
- **Completed:** `YYYY-MM-DD HH:MM America/Sao_Paulo`
- **Final recommendation:** `Ready for Phase 6B automated smoke planning` or `Not ready: release blockers remain`
```

Set the `Final verification` row to:

```markdown
| Final verification | pass | `pnpm test`, `pnpm build`, `docker compose config --quiet`, `pnpm run doctor`, Compose-aware doctor, `/health`, and `/ready` passed. |
```

Replace the `Final Recommendation` section with a short paragraph that states whether Phase 6A passed and names any unresolved follow-ups.

- [ ] **Step 4: Update `CLAUDE.md` only if durable context changed**

If Phase 6A only produced a run record and small docs fixes, update:

```markdown
- Current phase: Phase 6A Release Candidate Install Trial.
```

If it introduced a durable command or convention, add one bullet under `Project Conventions`. Do not add transient command logs to `CLAUDE.md`.

- [ ] **Step 5: Update versioned memory**

Open the config repo path:

```sh
sed -n '1p' /Users/diogo/.codex/.config-repo-path
```

Update `/Users/diogo/Developer/Github/claude-config/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md`.

Add a concise entry with:

```markdown
- Completed Phase 6A Release Candidate Install Trial on commit `SHORT_SHA_FROM_FINAL_SIGNALHUB_COMMIT`.
- RC drill result: `ready` or `not ready`.
- Evidence record: `docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md`.
- Final verification: `pnpm test`, `pnpm build`, `docker compose config --quiet`, `pnpm run doctor`, Compose-aware doctor, `/health`, and `/ready` passed.
- Follow-ups: `none` or a concise comma-separated list.
```

- [ ] **Step 6: Commit final docs and memory updates**

In SignalHub:

```sh
git add docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md CLAUDE.md README.md .env.example docs/HTTP-INGESTION.md .claude/docs
git commit -m "docs: complete phase 6a install trial"
```

Expected: commit succeeds with only files that actually changed. If `git add` reports unmatched files, rerun it with the concrete changed paths from `git status -sb`.

In the config repo:

```sh
git add projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
git commit -m "memory: record SignalHub phase 6a completion"
```

Expected: commit succeeds. Leave unrelated untracked project memory directories alone.

## Task 11: Clean Up Trial Runtime

**Files:**
- Modify: `docs/superpowers/runs/2026-05-15-phase6a-release-candidate-install-trial.md` only if cleanup evidence is worth retaining

- [ ] **Step 1: Stop the trial Compose stack**

Run:

```sh
docker compose -p signalhub_phase6a_rc down
```

Expected: containers and network stop.

- [ ] **Step 2: Preserve or remove volumes based on final debugging needs**

If all findings are resolved and no runtime evidence is needed, run:

```sh
docker compose -p signalhub_phase6a_rc down -v
```

Expected: trial volumes are removed.

If unresolved release blockers remain, do not remove volumes. Record this under `Final Recommendation`:

```markdown
Trial volumes were intentionally preserved for blocker investigation under Compose project `signalhub_phase6a_rc`.
```

- [ ] **Step 3: Remove the throwaway checkout only after final verification is committed**

Run:

```sh
rm -rf /private/tmp/signalhub-phase6a-rc
```

Expected: throwaway checkout is removed.

- [ ] **Step 4: Confirm final SignalHub status**

Run:

```sh
git status -sb
```

Expected: branch is clean except for intentional ahead-of-origin commits.

## Final Handoff

After Task 11, report:

- final RC recommendation;
- commits created;
- verification commands and outcomes;
- unresolved follow-ups;
- whether the trial Compose volumes were removed or preserved;
- whether `origin/main` still needs a push.
