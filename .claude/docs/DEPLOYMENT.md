# Deployment

Docker Compose is the only production-supported self-hosted installation path for this release line. Kubernetes, Helm, systemd, and hosted SaaS deployment are out of scope.

## Deployment Identity

SignalMonitor's intended public website and domain is `sigmon.app`. The intended deployed application host is `my.sigmon.app`.

EasyPanel VPS deployment comes after Phase 6D critical hygiene. Until that work is complete, deployment documentation should describe identity and supported local/Compose paths without implementing the VPS deployment flow.

## Local Compose

1. Create `.env` from `.env.example`.
2. Replace secrets and database password.
3. Install dependencies:

   ```sh
   pnpm install
   ```

4. Run local read-only diagnostics:

   ```sh
   pnpm run doctor
   ```

5. Start dependencies:

   ```sh
   docker compose up -d postgres redis
   ```

6. Seed the bootstrap admin:

   ```sh
   docker compose run --rm api pnpm seed:admin
   ```

7. Start the stack:

   ```sh
   docker compose up -d --build
   ```

8. Run Compose-aware diagnostics:

   ```sh
   pnpm run doctor -- --compose --api-url http://localhost:3000
   ```

## Doctor

SignalMonitor includes read-only operator diagnostics for install and release checks:

```sh
pnpm run doctor
pnpm run doctor -- --compose --api-url http://localhost:3000
```

Results are reported as pass, warn, or fail. Failures produce a non-zero exit code; warnings do not. The checks validate environment shape, placeholder secrets, local prerequisites, Compose rendering, service reachability, and API health without mutating data or revealing secret values.

In production mode, doctor rejects missing or local-only `POSTGRES_PASSWORD` values, including the Compose fallback placeholder. It also rejects placeholder production secrets.

Use `pnpm run doctor` to invoke the project script. `pnpm doctor` is pnpm's built-in diagnostic and does not run SignalMonitor's operator diagnostics.

For release-readiness checks, run `pnpm smoke:compose` from a clean checkout after dependencies are installed. The command uses disposable Docker Compose resources, generates local-only secrets, verifies the critical install path, and cleans up by default. It is a validation harness, not a production runtime service.

## CI Gate

GitHub Actions runs the release-readiness baseline for pull requests to `main` and pushes to `main`: `pnpm test`, `pnpm build`, `docker compose config --quiet`, and `pnpm smoke:compose --project-name sigmon_ci_smoke --preserve`.

The workflow uses GitHub-maintained actions that run on the Node 24 action runtime (`actions/checkout@v6` and `actions/setup-node@v6`). This is separate from the application runtime, which remains Node.js 22.

The CI smoke job validates the Docker Compose install path with generated local-only secrets. It preserves smoke resources long enough to collect failure diagnostics, then explicitly cleans them up with `docker compose -p sigmon_ci_smoke down -v || true`. It does not publish images or create releases.

On pushes to `main`, the `Deploy EasyPanel` job runs only after the test, build, Compose config, and Compose smoke jobs pass. It calls EasyPanel deploy hooks from GitHub Actions secrets:

- `EASYPANEL_API_DEPLOY_URL` triggers the `api` service deploy. The older `EASYPANEL_DEPLOY_URL` name is accepted as an API-only alias.
- `EASYPANEL_WORKER_DEPLOY_URL` triggers the `worker` service deploy.
- `EASYPANEL_SCHEDULER_DEPLOY_URL` triggers the scheduler service deploy when the scheduler is split into its own EasyPanel app service.

Postgres and Redis do not use repository-triggered deploy hooks. They are stateful EasyPanel template services and should be managed directly in EasyPanel.

## SDK Publishing

The JavaScript/TypeScript SDK is published as the public npm package `@sigmon/sdk`. GitHub Actions workflow `Publish SDK` runs when a GitHub release is published, and can also be started manually with `workflow_dispatch`.

The workflow installs dependencies with frozen pnpm, builds only `@sigmon/sdk`, and publishes from the SDK package directory:

```sh
npm publish --access public
```

Publishing uses npm Trusted Publishing through GitHub Actions OIDC. The workflow grants `id-token: write` and intentionally does not use an `NPM_TOKEN` secret.

Before the first publish, create or claim the npm `@sigmon` organization/scope. If npm does not allow Trusted Publishing to be configured before the package exists, bootstrap `@sigmon/sdk` once from a locally authenticated npm session with `npm publish --access public`, then configure the package Trusted Publisher for GitHub Actions repository `DiogoHSM/sigmon` and workflow `publish-sdk.yml`.

Before publishing a new SDK release, update `packages/sdk/package.json` version, run the release baseline, merge to `main`, then publish a GitHub release for that version. Future publishes should happen through the `Publish SDK` workflow, not a long-lived npm token.

## Services

- `postgres`: Postgres 16, bound to `127.0.0.1:${POSTGRES_PORT:-5432}`.
- `redis`: Redis 7 with append-only persistence, bound to `127.0.0.1:${REDIS_PORT:-6379}`.
- `api`: Fastify API on host port `3000`.
- `worker`: BullMQ telemetry worker with `WORKER_ROLE=queue`.
- `scheduler`: scheduled retention, backup, alert, and monitor evaluation worker with `WORKER_ROLE=scheduler`. For smaller deployments, a single worker can run both responsibilities with `WORKER_ROLE=all`.

`WORKER_ROLE` is only operationally meaningful for processes started with `pnpm start:worker`. In split EasyPanel deployments, set `WORKER_ROLE=queue` on the queue worker service and `WORKER_ROLE=scheduler` on the scheduler service. The scheduler service also needs the same shared runtime env vars as the worker (`DATABASE_URL`, `REDIS_URL`, secrets, SMTP, retention, monitor, alert, and backup settings) because it evaluates background jobs directly.

The API, worker, and scheduler containers are built from the project Dockerfile. The image includes `postgresql16-client`, `curl`, and `tini`, runs as the non-root `sigmon` user, and uses `tini` as the entrypoint. The Dockerfile copies application files with `sigmon` ownership and runs install/build as `sigmon`, avoiding a final recursive ownership rewrite over `/app` during EasyPanel image export. Dependency installation is isolated behind workspace package manifest copies and a BuildKit pnpm-store cache mount, so ordinary source or documentation changes can reuse the install layer. `.dockerignore` excludes local worktrees, `node_modules`, generated `dist` folders, secrets notes, and other non-build artifacts from local Docker contexts. Compose defines healthchecks for all four services.

The console `System` mode reads separate `worker` and `scheduler` heartbeats and shows a non-secret deploy config summary. Use it after deploy to confirm both background services are alive and that API-visible config such as SMTP, alerts, monitors, retention, backups, and public endpoint settings loaded as expected.

## Retention

Telemetry retention is built into the scheduler role. Set the `RETENTION_*` environment variables in `.env` to control scheduled deletion, interval, batch size, and per-table retention windows. No external cron job is needed.

Set `RETENTION_ENABLED=false` to stop scheduled deletion while keeping the queue worker available for ingestion jobs.

## Simple Alerts

Simple alert evaluation is built into the scheduler role. Set `ALERTS_ENABLED`, `ALERTS_INTERVAL_MINUTES`, `ALERTS_WEBHOOK_TIMEOUT_MS`, and SMTP variables in `.env` to control scheduled alert evaluation and webhook/email delivery. No external cron job is needed.

Set `ALERTS_ENABLED=false` to stop scheduled alert evaluation while keeping the worker available for ingestion and retention.

## Monitors

HTTP uptime and heartbeat monitors are evaluated by the scheduler role. Set `MONITORS_ENABLED`, `MONITORS_INTERVAL_MINUTES`, `MONITORS_HTTP_TIMEOUT_MS`, and `MONITORS_MAX_CONCURRENCY` to control polling cadence and concurrency. The scheduler records monitor checks and emits monitor-backed alert events when a monitor transitions down or recovers.

Heartbeat monitors are created through the admin monitor API. The create response returns a one-time `shhb_...` secret; callers check in with:

```sh
curl -X POST https://my.sigmon.app/v1/heartbeats/<monitor-id> \
  -H "Authorization: Bearer <heartbeat-secret>"
```

Set `MONITORS_ENABLED=false` to stop monitor evaluation while leaving queue ingestion and other scheduler responsibilities available according to `WORKER_ROLE`.

## Source Maps

Source-map artifact storage is local-first. Set `SOURCE_MAPS_LOCAL_DIR` and `SOURCE_MAPS_MAX_UPLOAD_MB` in `.env` to control where the API stores uploaded `.map` files and the maximum upload size. Docker Compose mounts the `source_map_data` volume into the API at `/var/lib/sigmon/source-maps`, which matches the default `SOURCE_MAPS_LOCAL_DIR`.

Admins upload source maps from the console `Artifacts` mode after selecting a project and environment. Single `.map` files and `.zip` bundles are supported. Stack resolution uses strict project, environment, release, and minified filename matching; release values in ingested error payloads must match the uploaded artifact release.

Source-map artifact retention is local-first and worker-owned. Set `SOURCE_MAPS_RETENTION_ENABLED`, `SOURCE_MAPS_RETENTION_DAYS`, and `SOURCE_MAPS_RETENTION_BATCH_SIZE` to control cleanup. The scheduler runs with telemetry retention; setting `RETENTION_ENABLED=false` disables scheduled source-map cleanup too.

## Backups and Restore

Postgres logical backups are built into the scheduler role. Set `BACKUPS_ENABLED=true`, `BACKUPS_INTERVAL_HOURS`, `BACKUPS_LOCAL_DIR`, and `BACKUPS_RETENTION_DAYS` in `.env` to control scheduled backups and local pruning. The Compose worker mounts `backup_data` at `/var/lib/sigmon/backups`, which matches the default `BACKUPS_LOCAL_DIR`. Each backup writes a SHA-256 sidecar, and restore verifies the sidecar when present.

The image includes `postgresql16-client` so `pg_dump` and `pg_restore` are available for backup scripts. Manual backups can be run with:

```sh
docker compose run --rm worker pnpm backup:create
```

Optional S3-compatible remote upload is configured with:

```dotenv
BACKUPS_S3_ENABLED=true
BACKUPS_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
BACKUPS_S3_REGION=auto
BACKUPS_S3_BUCKET=sigmon-backups
BACKUPS_S3_ACCESS_KEY_ID=<r2-access-key-id>
BACKUPS_S3_SECRET_ACCESS_KEY=<r2-secret-access-key>
BACKUPS_S3_PREFIX=production/sigmon
```

For Cloudflare R2 backup storage, use a private bucket and a scoped token. Remote backup retention is managed by bucket lifecycle rules in this slice. Source-map object storage remains deferred.

Restore is destructive and requires the API and worker to be stopped before running `pg_restore`:

```sh
docker compose stop api worker
docker compose run --rm worker pnpm backup:restore -- /var/lib/sigmon/backups/sigmon-YYYYMMDDTHHMMSSZ.dump --yes
docker compose start api worker
```

## Migrations

The API runs migrations during startup. Operators can also run migrations explicitly with:

```sh
pnpm db:migrate
```

## Readiness

Use:

```sh
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

`/ready` checks Postgres and Redis. The ingestion API returns `503` if it cannot verify keys or enqueue jobs.

## Password Rotation

For an existing Compose `postgres_data` volume, change the `sigmon` role password inside Postgres before changing `.env`. Then update `POSTGRES_PASSWORD`, update `POSTGRES_PASSWORD_URLENCODED` when needed, and restart API and worker.

## Verification

Before deployment or release:

```sh
pnpm test
pnpm build
docker compose config --quiet
pnpm run doctor
pnpm smoke:compose
```

## Console Deployment

Production builds include `apps/console/dist`. The API serves the console at `/console` when `CONSOLE_ENABLED=true` or `NODE_ENV=production`, and exposes non-secret runtime config at `/console/config`.

Set `SIGMON_PUBLIC_ENDPOINT` to the externally reachable API origin when SignalMonitor runs behind a domain, HTTPS reverse proxy, or non-default port. The console uses that value in SDK, HTTP, and environment snippets.

Set `BROWSER_CORS_ORIGINS` on the API service when browser SDK telemetry should post directly from another app origin to SignalMonitor. Use a comma-separated allowlist of exact origins such as `https://app.controledaempresa.com,https://microerp.example.com`. This CORS handling is limited to public ingestion endpoints under `/v1/*`; admin, query, auth, system, docs, and console routes remain outside the browser ingestion CORS allowlist.

Public SDK docs are served at `/sdk`, API reference docs are served at `/docs`, and the raw OpenAPI 3.1 document is served at `/openapi.json`. For the EasyPanel deployment, use `https://my.sigmon.app/sdk`, `https://my.sigmon.app/docs`, and `https://my.sigmon.app/openapi.json`. The docs are public, but protected endpoints still require their normal ingestion API key, source-map upload token, heartbeat secret, or human session cookie.

Local development can run the API with `pnpm dev:api` and the console with `pnpm dev:console`.
