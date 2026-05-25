# SignalMonitor

SignalMonitor is a self-hosted telemetry core for product analytics, error tracking, LLM observability, traces, and spans. One installation can monitor multiple projects and environments. Clients ingest telemetry with project-environment API keys, the API validates and queues each signal in Redis/BullMQ, and the worker sanitizes and persists typed records in Postgres.

The intended public website and domain is `sigmon.app`; the future deployed app host is `my.sigmon.app`.

## Current Capabilities

- Local admin login with a bootstrap admin seed.
- Admin management for users, projects, environments, and scoped ingestion API keys.
- API-key ingestion for events, errors, LLM calls, traces, and spans.
- Zod payload validation and recursive sanitization before persistence.
- Redis-backed ingestion queue with worker processing.
- Postgres storage for operational data and typed telemetry tables.
- Deterministic error grouping with group status workflow and raw occurrence drilldown.
- Error-first Incident view for grouped and raw errors with priority triage, related context, and shareable URLs.
- Admin source-map artifact uploads and on-demand production stack resolution.
- Lightweight breadcrumb ingestion and session context timelines for raw error debugging.
- Human-session query endpoints for raw telemetry and basic aggregates.
- JavaScript SDK and raw HTTP integration guide.
- Integration Console for setup, overview, investigation, alerts, and system health.
- Worker-owned retention, heartbeat, and operational health reporting.
- Worker-owned simple alerts with internal history and optional webhook delivery.
- Health and readiness endpoints for API, Postgres, and Redis checks.
- Read-only operator doctor checks for local and Docker Compose installs.
- Critical runtime hardening for webhook targets, idempotent ingestion retries, structured redacted logs, checksum-verified backups, non-root containers, security headers, and production session cookies.

SignalMonitor does not implement a SaaS workspace model, billing, invites, per-project RBAC, ClickHouse, product object storage, or stored log telemetry.

## Prerequisites

- Node.js 22.x is the release baseline. Newer Node.js versions may work for local drills, but 22.x is the supported target.
- pnpm 9.15.x
- Docker and Docker Compose

## Required Secrets

Create `.env` from `.env.example` and replace the example values before running anything beyond a disposable local install.

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres URL used by local Node processes. |
| `REDIS_URL` | Yes | Redis URL used by local Node processes. |
| `POSTGRES_PASSWORD` | Yes for Compose | Password for the Compose Postgres user. Set before first database start. |
| `POSTGRES_PASSWORD_URLENCODED` | Sometimes | URL-encoded copy of `POSTGRES_PASSWORD` when it contains URL-reserved characters. |
| `SESSION_SECRET` | Yes | At least 32 characters outside tests. Signs human session cookies. |
| `API_KEY_PEPPER` | Yes | At least 32 characters outside tests. Used when hashing ingestion API keys. |
| `CONSOLE_ENABLED` | No | Enables the built Integration Console from the API. Compose sets this to `true`. |
| `SIGMON_PUBLIC_ENDPOINT` | No | Public API origin used in console snippets, for example `https://sigmon.example.com`. |
| `SOURCE_MAPS_LOCAL_DIR` | No | Local directory for uploaded source-map artifacts. Defaults to `/var/lib/sigmon/source-maps`. |
| `SOURCE_MAPS_MAX_UPLOAD_MB` | No | Maximum source-map upload size in MiB. Defaults to `50`. |
| `BOOTSTRAP_ADMIN_EMAIL` | Yes | Email for the first admin account. |
| `BOOTSTRAP_ADMIN_PASSWORD` | Yes | At least 32 characters outside tests. Used by the admin seed script. |
| `GOOGLE_OAUTH_ENABLED` | No | Enables Google OAuth when set to `true` and all Google settings are present. |
| `GOOGLE_CLIENT_ID` | If OAuth enabled | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | If OAuth enabled | Google OAuth client secret. |
| `GOOGLE_REDIRECT_URI` | If OAuth enabled | OAuth callback URL, usually `http://localhost:3000/auth/google/callback` locally. |

Google OAuth is optional. It is not open signup: Google sign-in only succeeds for an existing, unarchived local user with a verified Google email. On first successful Google login, SignalMonitor links that user's Google subject to the local account.

Do not commit real secrets. Root-level `SECRETS.md` is ignored for local operator notes. The committed `.claude/docs/SECRETS.md` contains sanitized variable names and safe examples only.

## Operational Config

Retention, alert scheduler, backup scheduler, source-map storage, and source-map retention settings are non-secret operational config. S3-compatible backup credentials are secrets. All variables are documented in `.env.example` and `.claude/docs/SECRETS.md`.

## Runtime Hardening

Webhook notification URLs are rejected in every environment when they target local, private, link-local, multicast, loopback, or cloud metadata networks. In production, webhook delivery uses the resolved safe address to avoid DNS rebinding between validation and fetch.

Telemetry queue retries are idempotent. Queue jobs use deterministic IDs derived from telemetry payload IDs, and database writes ignore duplicate telemetry IDs.

The API and worker use structured logs with redaction for secret-bearing fields. Unhandled API errors return sanitized JSON while the server logs the redacted error. API startup failures log and run cleanup; API and worker shutdown is ordered and bounded.

Docker images run as the non-root `sigmon` user under `tini`, and Docker Compose defines healthchecks for Postgres, Redis, API, and worker services. Production doctor checks reject local-only password placeholders.

HTTP security headers are set on API responses. In production, the human session cookie uses the `__Host-sigmon_session` name with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`.

## Operational Safety

The worker runs telemetry retention by default. Retention environment variables control scheduled deletion of old telemetry with bounded delete statements; each run can process a limited number of batches and later scheduled runs continue draining older rows.

Retention deletes telemetry rows and, when source-map retention is enabled, local source-map artifacts. Operational metadata, projects, environments, users, and API keys are not deleted by retention.

| Telemetry type | Default retention |
| --- | --- |
| Events | 90 days |
| Errors | 180 days |
| Traces | 90 days |
| Spans | 90 days |
| LLM calls | 180 days |
| Breadcrumbs | 30 days |

Source-map retention is worker-owned and local-storage-only. When `RETENTION_ENABLED=true` and `SOURCE_MAPS_RETENTION_ENABLED=true`, the worker deletes source-map artifacts older than `SOURCE_MAPS_RETENTION_DAYS` in batches of `SOURCE_MAPS_RETENTION_BATCH_SIZE`. Cleanup removes local files, artifact metadata, and cached stack resolutions.

Set `RETENTION_ENABLED=false` to disable scheduled deletion, including scheduled source-map cleanup. The other retention variables configure the run interval, batch size, and per-table retention windows.

The console `System` mode is available to logged-in users. It shows API, queue worker, scheduler, Postgres, Redis, queue, ingestion freshness, deploy config, retention, and backup status from the system health endpoint. The queue worker and scheduler cards use separate heartbeats, so split EasyPanel services can be checked independently.

## Backups and Restore

The worker owns scheduled Postgres logical backups. When `BACKUPS_ENABLED=true`, it runs `pg_dump` in custom format and writes files named like `sigmon-YYYYMMDDTHHMMSSZ.dump` to `BACKUPS_LOCAL_DIR`.

Docker Compose mounts the `backup_data` volume at `/var/lib/sigmon/backups` in the worker container. Each dump gets a SHA-256 sidecar file, and restore verifies the sidecar when present before running `pg_restore`. Local retention deletes old local backup files and sidecars according to `BACKUPS_RETENTION_DAYS`. Backup run metadata is stored in Postgres; the dump files and sidecars remain on local storage and, optionally, remote object storage.

Run a manual backup with:

```sh
docker compose run --rm worker pnpm backup:create
```

Restore is destructive. Stop the API and worker before restoring so no process writes to Postgres during `pg_restore`:

```sh
docker compose stop api worker
docker compose run --rm worker pnpm backup:restore -- /var/lib/sigmon/backups/sigmon-YYYYMMDDTHHMMSSZ.dump --yes
docker compose start api worker
```

For Cloudflare R2, use a private bucket and a scoped token that can write backup objects. Example:

```dotenv
BACKUPS_S3_ENABLED=true
BACKUPS_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
BACKUPS_S3_REGION=auto
BACKUPS_S3_BUCKET=sigmon-backups
BACKUPS_S3_ACCESS_KEY_ID=<r2-access-key-id>
BACKUPS_S3_SECRET_ACCESS_KEY=<r2-secret-access-key>
BACKUPS_S3_PREFIX=production/sigmon
```

Remote retention is handled by bucket lifecycle rules in this slice.

## Simple Alerts

SignalMonitor evaluates simple project/environment-scoped alert rules from the worker process. Supported rule types are critical error count, total error count, trace p95 latency, and LLM cost thresholds over rolling windows.

Alert events are stored internally. Optional generic webhook channels send compact JSON payloads and record each delivery attempt. Native email, Telegram, Discord, escalation, silencing, acknowledgement, and retry workflows are out of scope for this slice.

Webhook secrets are write-only. Saved secret values are redacted and are never returned by the API or displayed in the console.

## Source Maps

Admins can upload frontend source-map artifacts from the console `Artifacts` mode for the active project and environment. Uploads support a single `.map` file or a `.zip` bundle of `.map` files. Artifacts are matched strictly by project, environment, release, and minified filename; SignalMonitor does not guess across releases.

Source maps are local-first in this release line. The API stores files under `SOURCE_MAPS_LOCAL_DIR`, and Docker Compose mounts the `source_map_data` volume at `/var/lib/sigmon/source-maps`. Metadata and cached resolved frame locations are stored in Postgres. Deleting a source-map artifact clears cached stack resolutions for errors that referenced that artifact and removes the local file.

Source-map retention is worker-owned and local-storage-only. When `RETENTION_ENABLED=true` and `SOURCE_MAPS_RETENTION_ENABLED=true`, the worker deletes source-map artifacts older than `SOURCE_MAPS_RETENTION_DAYS` in batches of `SOURCE_MAPS_RETENTION_BATCH_SIZE`. Cleanup removes local files, artifact metadata, and cached stack resolutions.

Raw error details resolve production stack frames on demand when the error has a matching release and uploaded map. The console shows original file, line, column, and symbol metadata only. It does not display source code or `sourcesContent`.

## Source Map CI Uploads

Admins can create source-map upload tokens from the console `Artifacts` mode. These tokens are separate from browser ingestion API keys and are intended for CI systems only.

Generic shell example:

```sh
pnpm source-maps:upload \
  --endpoint https://sigmon.example.com \
  --token "$SIGMON_SOURCE_MAP_TOKEN" \
  --project-id "$SIGMON_PROJECT_ID" \
  --environment-id "$SIGMON_ENVIRONMENT_ID" \
  --release "$GITHUB_SHA" \
  --bundle ./dist/source-maps.zip
```

GitHub Actions example:

```yaml
- name: Upload source maps
  run: |
    pnpm source-maps:upload \
      --endpoint "${{ secrets.SIGMON_ENDPOINT }}" \
      --token "${{ secrets.SIGMON_SOURCE_MAP_TOKEN }}" \
      --project-id "${{ secrets.SIGMON_PROJECT_ID }}" \
      --environment-id "${{ secrets.SIGMON_ENVIRONMENT_ID }}" \
      --release "${{ github.sha }}" \
      --bundle ./dist/source-maps.zip
```

Store upload tokens in CI secret storage. Do not expose them in browser bundles.

## Breadcrumbs and Session Context

SignalMonitor supports lightweight breadcrumbs for session debugging. Breadcrumbs are structured telemetry records for navigation, safe clicks, console warnings/errors, failed or slow network summaries, and custom application steps.

Manual SDK example:

```ts
client.breadcrumb({
  type: "custom",
  category: "checkout",
  message: "Selected shipping method",
  data: { method: "standard" }
});
```

Breadcrumbs must not include secrets, raw form values, request bodies, response bodies, cookies, or headers. Browser auto-capture helpers sanitize URLs and element summaries, and network capture is disabled by default.

## Incident Investigation

SignalMonitor includes an error-first Incident view for grouped errors and raw occurrences. Operators can open a shareable incident URL from `Investigate > Errors`, review severity, status, suggested and saved priority, source-map status, primary occurrence details, strongly related signals, and nearby context.

## Local Development

1. Create local environment settings:

   ```sh
   cp .env.example .env
   ```

2. Edit `.env`. Replace `SESSION_SECRET`, `API_KEY_PEPPER`, `BOOTSTRAP_ADMIN_PASSWORD`, and `POSTGRES_PASSWORD` with strong values.

3. Install dependencies:

   ```sh
   pnpm install
   ```

4. Start Postgres and Redis:

   ```sh
   docker compose up -d postgres redis
   ```

5. Run migrations and seed the bootstrap admin:

   ```sh
   pnpm db:migrate
   pnpm seed:admin
   ```

   The API also runs migrations on startup for self-hosted deployments. The seed script creates the bootstrap admin only if that email does not already exist as an admin.

6. Start the API and worker in separate terminals:

   ```sh
   pnpm dev:api
   pnpm dev:worker
   ```

7. Check health:

   ```sh
   curl http://localhost:3000/health
   curl http://localhost:3000/ready
   ```

## Docker Compose Setup

Docker Compose is the supported production-oriented self-hosted install path for this release line. Kubernetes, Helm, systemd, and hosted SaaS deployment are out of scope.

Docker Compose starts Postgres, Redis, the API, and the telemetry worker. It loads `.env` when present and overrides `DATABASE_URL` and `REDIS_URL` for the internal Compose network.

```sh
cp .env.example .env
# edit .env before first start
pnpm install
pnpm run doctor
docker compose up -d postgres redis
docker compose run --rm api pnpm seed:admin
docker compose up -d --build
pnpm run doctor -- --compose --api-url http://localhost:3000
```

The API container serves the Integration Console at `http://localhost:3000/console`. Set `SIGMON_PUBLIC_ENDPOINT` to the externally reachable API origin before deploying behind a domain, HTTPS reverse proxy, or non-default port so generated snippets point at the correct endpoint.

Compose binds Postgres and Redis to `127.0.0.1` for local tooling. Change `POSTGRES_PORT`, `REDIS_PORT`, and secrets in `.env` before exposing services or reusing the stack outside local development.

If `POSTGRES_PASSWORD` contains URL-reserved characters, set `POSTGRES_PASSWORD_URLENCODED` to the URL-encoded form and use the encoded value in `DATABASE_URL`. If rotating the password on an existing `postgres_data` volume, first change the `sigmon` role password inside Postgres, then update `.env` and restart the API and worker.

Validate the Compose file with:

```sh
docker compose config --quiet
```

## Operator Doctor

Run the read-only operator diagnostics before startup and after Compose is running:

```sh
pnpm run doctor
pnpm run doctor -- --compose --api-url http://localhost:3000
```

Doctor results are reported as pass, warn, or fail. The command exits non-zero only when a failure is found; warnings are advisory and keep a zero exit code. The checks are read-only: they validate configuration shape, placeholder usage, local prerequisites, Compose rendering, service reachability, and API health without mutating data or secrets.

Use `pnpm run doctor` to run the SignalMonitor project script. `pnpm doctor` is pnpm's built-in diagnostic command and does not run SignalMonitor's operator checks.

## Compose Smoke Harness

Run the release smoke harness against disposable Docker Compose resources:

```sh
pnpm smoke:compose
```

The harness generates a temporary env file with local-only secrets, starts the Compose dependencies, seeds the bootstrap admin, starts the API and worker, uploads source maps, ingests representative telemetry, verifies query/readiness flows, creates a backup, verifies restore confirmation safety, restores the backup, and checks the restored data.

By default it removes the Compose project and temporary files after the run. Use `--preserve` to inspect a failed run:

```sh
pnpm smoke:compose --preserve
```

Use `--project-name` or `SIGMON_SMOKE_PROJECT_NAME` when running multiple smoke jobs on the same Docker host.

## Continuous Integration

Pull requests to `main` and pushes to `main` run the GitHub Actions CI gate. CI installs dependencies with the repo-pinned pnpm version, then runs tests, build, Docker Compose config validation, and the Compose smoke harness.

The workflow uses GitHub-maintained actions on the Node 24 action runtime (`actions/checkout@v6` and `actions/setup-node@v6`). SignalMonitor's application runtime remains Node.js 22.

The smoke job runs `pnpm smoke:compose --project-name sigmon_ci_smoke --preserve` to validate the self-hosted Docker Compose install path in a clean GitHub-hosted runner. The workflow preserves resources long enough to collect failure diagnostics, then explicitly cleans them up with `docker compose -p sigmon_ci_smoke down -v || true`. The same `pnpm smoke:compose` command remains available for local release checks.

On pushes to `main`, CI also triggers EasyPanel deploy hooks after all gates pass. Configure GitHub Actions secrets for the app services only:

- `EASYPANEL_API_DEPLOY_URL` for the EasyPanel `api` service. The legacy `EASYPANEL_DEPLOY_URL` secret is also accepted as an API deploy URL.
- `EASYPANEL_WORKER_DEPLOY_URL` for the EasyPanel `worker` service.
- `EASYPANEL_SCHEDULER_DEPLOY_URL` for the EasyPanel `scheduler` service when scheduler work runs as a split service. Omit it when scheduler work runs inside the worker service.

Do not configure deploy hooks for Postgres or Redis. They are stateful EasyPanel template services and should not be redeployed from the repository build.

## Upgrade Flow

Create a backup before upgrading, stop writers during migration, then verify the upgraded stack:

```sh
docker compose run --rm worker pnpm backup:create
git pull
pnpm install
docker compose build
docker compose stop api worker
docker compose run --rm api pnpm db:migrate
docker compose up -d
pnpm run doctor -- --compose --api-url http://localhost:3000
```

## Restore Drill

Restore is destructive: it replaces the current database state from the selected dump. Practice this flow in a disposable or copied environment before relying on it during an incident.

```sh
docker compose stop api worker
docker compose run --rm worker pnpm backup:restore -- /var/lib/sigmon/backups/sigmon-YYYYMMDDTHHMMSSZ.dump --yes
docker compose start api worker
pnpm run doctor -- --compose --api-url http://localhost:3000
```

## Admin Bootstrap

Seed the first admin from `.env`:

```sh
pnpm seed:admin
```

Log in and store the session cookie:

```sh
curl -i -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"change-me-admin-password-32-chars-min"}' \
  http://localhost:3000/auth/login
```

Check the logged-in user:

```sh
curl -b cookies.txt http://localhost:3000/auth/me
```

## API Key Creation

Create a project:

```sh
curl -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"name":"Demo Project"}' \
  http://localhost:3000/admin/projects
```

Create an environment:

```sh
curl -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"name":"production"}' \
  http://localhost:3000/admin/projects/prj_YOUR_PROJECT_ID/environments
```

Create an ingestion API key:

```sh
curl -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"environmentId":"env_YOUR_ENVIRONMENT_ID","name":"Production ingest"}' \
  http://localhost:3000/admin/projects/prj_YOUR_PROJECT_ID/api-keys
```

Copy the one-time `apiKey.secret` from the response. The stored record keeps only a prefix and hash, so the full secret is not shown again.

## API Documentation

Deployed SignalMonitor instances expose public API reference docs at `/docs` and the raw OpenAPI 3.1 document at `/openapi.json`.

For the EasyPanel deployment, use:

- `https://my.sigmon.app/docs`
- `https://my.sigmon.app/openapi.json`

The docs are public, but protected endpoints still require their normal ingestion API key, source-map upload token, or human session cookie.

## Ingestion Examples

All ingestion endpoints require `Authorization: Bearer sh_YOUR_API_KEY_SECRET`. Successful requests return `202 Accepted` with `{ "accepted": true, "id": "..." }`.

### SDK

Browser apps should import the browser entrypoint and use a scoped browser ingestion key. Browser ingestion keys are expected to be public, so scope them to the intended project and environment.

```ts
import { createSignalMonitorClient } from "@sigmon/sdk/browser";

const signalMonitor = createSignalMonitorClient({
  endpoint: "https://sigmon.example.com",
  apiKey: "sh_BROWSER_INGESTION_KEY"
});

signalMonitor.track("checkout.started", {
  plan: "team"
});
```

Server-side code should import the node entrypoint. Server-side ingestion keys must stay in server secret storage and must not be bundled into browser code.

```ts
import { createSignalMonitorClient } from "@sigmon/sdk/node";

const signalMonitor = createSignalMonitorClient({
  endpoint: process.env.SIGMON_ENDPOINT ?? "https://sigmon.example.com",
  apiKey: process.env.SIGMON_SERVER_INGESTION_KEY ?? ""
});
```

#### Next.js App Router

Next.js App Router projects can wrap server route handlers with `@sigmon/sdk/next`. Keep the API key in server-only environment variables.

```ts
// app/api/health/route.ts
import { createSignalMonitorNextClient, withSignalMonitorRoute } from "@sigmon/sdk/next";

const sigmon = createSignalMonitorNextClient({
  endpoint: process.env.SIGMON_ENDPOINT ?? "https://sigmon.example.com",
  apiKey: process.env.SIGMON_API_KEY!,
  defaultContext: {
    release: process.env.NEXT_PUBLIC_APP_VERSION,
    metadata: { service: "web" }
  }
});

export const GET = withSignalMonitorRoute(async () => {
  return Response.json({ ok: true });
}, {
  client: sigmon,
  routeName: "GET /api/health",
  getContext: async () => ({ tenantId: "tenant_123", userId: "user_123" })
});
```

Browser global error capture is explicit and opt-in. Install it from a Client Component with a scoped public browser ingestion key, and clean it up on unmount.

```tsx
"use client";

import { useEffect } from "react";
import { createSignalMonitorClient } from "@sigmon/sdk/browser";
import { installBrowserErrorCapture } from "@sigmon/sdk/next";

const sigmonBrowser = createSignalMonitorClient({
  endpoint: process.env.NEXT_PUBLIC_SIGMON_ENDPOINT ?? "https://sigmon.example.com",
  apiKey: process.env.NEXT_PUBLIC_SIGMON_BROWSER_KEY ?? "",
  defaultContext: {
    release: process.env.NEXT_PUBLIC_APP_VERSION,
    metadata: { service: "web" }
  }
});

export function SignalMonitorBrowserCapture() {
  useEffect(() => {
    return installBrowserErrorCapture(sigmonBrowser, {
      captureErrors: true,
      captureUnhandledRejections: true,
      flush: true
    });
  }, []);

  return null;
}
```

### Event

```sh
curl -i \
  -H "Authorization: Bearer sh_YOUR_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "account.created",
    "tenant_id": "tenant_123",
    "user_id": "user_456",
    "session_id": "sess_789",
    "source": "web",
    "release": "2026.05.02",
    "properties": {
      "plan": "pro",
      "signup_source": "invite"
    },
    "metadata": {
      "request_id": "req_abc"
    }
  }' \
  http://localhost:3000/v1/events
```

### Error

```sh
curl -i \
  -H "Authorization: Bearer sh_YOUR_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Payment provider timeout",
    "type": "PaymentTimeoutError",
    "severity": "error",
    "tenant_id": "tenant_123",
    "user_id": "user_456",
    "trace_id": "trace_checkout_001",
    "fingerprint": "payment-timeout",
    "stack": "PaymentTimeoutError: provider timeout\n    at chargeCustomer",
    "context": {
      "provider": "example-pay",
      "operation": "charge"
    },
    "metadata": {}
  }' \
  http://localhost:3000/v1/errors
```

### LLM Call

```sh
curl -i \
  -H "Authorization: Bearer sh_YOUR_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "model": "gpt-5-mini",
    "prompt_name": "dashboard_summary",
    "input_tokens": 1200,
    "output_tokens": 240,
    "cost_usd": 0.0123,
    "latency_ms": 842,
    "status": "success",
    "tenant_id": "tenant_123",
    "user_id": "user_456",
    "trace_id": "trace_report_001",
    "input_preview": "Summarize dashboard metrics for...",
    "output_preview": "Revenue increased by...",
    "metadata": {
      "workflow": "report_generation"
    }
  }' \
  http://localhost:3000/v1/llm
```

### Trace

```sh
curl -i \
  -H "Authorization: Bearer sh_YOUR_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "generate_dashboard",
    "status": "success",
    "started_at": "2026-05-02T12:00:00.000Z",
    "ended_at": "2026-05-02T12:00:02.400Z",
    "duration_ms": 2400,
    "tenant_id": "tenant_123",
    "user_id": "user_456",
    "session_id": "sess_789",
    "trace_id": "trace_dashboard_001",
    "metadata": {
      "entrypoint": "api"
    }
  }' \
  http://localhost:3000/v1/traces
```

### Span

```sh
curl -i \
  -H "Authorization: Bearer sh_YOUR_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "trace_id": "trace_dashboard_001",
    "parent_span_id": "spn_parent_optional",
    "name": "llm_generate_sql",
    "status": "success",
    "started_at": "2026-05-02T12:00:00.400Z",
    "ended_at": "2026-05-02T12:00:01.100Z",
    "duration_ms": 700,
    "tenant_id": "tenant_123",
    "user_id": "user_456",
    "input": {
      "prompt_name": "sql_generation"
    },
    "output": {
      "row_count": 12
    },
    "cost_usd": 0.0042,
    "metadata": {}
  }' \
  http://localhost:3000/v1/spans
```

## Query Examples

Query endpoints require a human session cookie from `/auth/login`. They require `project_id` and `environment_id`, accept `tenant_id`, `user_id`, `session_id`, `trace_id`, `from`, `to`, `limit`, and return `{ "data": ... }`.

### Raw Events

```sh
curl -b cookies.txt \
  "http://localhost:3000/query/events?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID&tenant_id=tenant_123&limit=25"
```

Other raw telemetry endpoints:

```sh
curl -b cookies.txt \
  "http://localhost:3000/query/errors?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID"

curl -b cookies.txt \
  "http://localhost:3000/query/llm-calls?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID&trace_id=trace_report_001"

curl -b cookies.txt \
  "http://localhost:3000/query/traces?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID&from=2026-05-02T00:00:00.000Z"

curl -b cookies.txt \
  "http://localhost:3000/query/traces/trace_dashboard_001/spans?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID"
```

### Aggregates

```sh
curl -b cookies.txt \
  "http://localhost:3000/query/aggregates/events?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID"

curl -b cookies.txt \
  "http://localhost:3000/query/aggregates/errors?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID"

curl -b cookies.txt \
  "http://localhost:3000/query/aggregates/llm?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID"

curl -b cookies.txt \
  "http://localhost:3000/query/aggregates/traces?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID"
```

## Troubleshooting

- If `pnpm run doctor` fails before Compose starts, fix `.env`, placeholder secrets, Node/pnpm versions, Docker availability, or Compose rendering before starting services.
- If `pnpm run doctor -- --compose --api-url http://localhost:3000` fails after startup, check `docker compose ps`, API logs, worker logs, Postgres readiness, Redis readiness, and whether `SIGMON_PUBLIC_ENDPOINT` matches the external origin.
- If admin seeding fails, verify `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, and database connectivity, then rerun `docker compose run --rm api pnpm seed:admin`.
- If restore fails, keep API and worker stopped, inspect the restore command output, and retry only in the intended environment with the intended dump path.

## Release Baseline

Run this baseline before tagging or shipping a release:

```sh
pnpm test
pnpm build
docker compose config --quiet
pnpm run doctor
```
