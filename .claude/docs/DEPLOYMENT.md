# Deployment

Docker Compose is the only production-supported self-hosted installation path for this release line. Kubernetes, Helm, systemd, and hosted SaaS deployment are out of scope.

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

SignalHub includes read-only operator diagnostics for install and release checks:

```sh
pnpm run doctor
pnpm run doctor -- --compose --api-url http://localhost:3000
```

Results are reported as pass, warn, or fail. Failures produce a non-zero exit code; warnings do not. The checks validate environment shape, placeholder secrets, local prerequisites, Compose rendering, service reachability, and API health without mutating data or revealing secret values.

Use `pnpm run doctor` to invoke the project script. `pnpm doctor` is pnpm's built-in diagnostic and does not run SignalHub's operator diagnostics.

For release-readiness checks, run `pnpm smoke:compose` from a clean checkout after dependencies are installed. The command uses disposable Docker Compose resources, generates local-only secrets, verifies the critical install path, and cleans up by default. It is a validation harness, not a production runtime service.

## Services

- `postgres`: Postgres 16, bound to `127.0.0.1:${POSTGRES_PORT:-5432}`.
- `redis`: Redis 7 with append-only persistence, bound to `127.0.0.1:${REDIS_PORT:-6379}`.
- `api`: Fastify API on host port `3000`.
- `worker`: BullMQ telemetry worker.

## Retention

Telemetry retention is built into the worker. Set the `RETENTION_*` environment variables in `.env` to control scheduled deletion, interval, batch size, and per-table retention windows. No extra cron job or external scheduler is needed.

Set `RETENTION_ENABLED=false` to stop scheduled deletion while keeping the worker available for ingestion jobs.

## Simple Alerts

Simple alert evaluation is built into the worker. Set `ALERTS_ENABLED`, `ALERTS_INTERVAL_MINUTES`, and `ALERTS_WEBHOOK_TIMEOUT_MS` in `.env` to control worker-owned alert scheduling and webhook delivery timeout. No extra cron job or external scheduler is needed.

Set `ALERTS_ENABLED=false` to stop scheduled alert evaluation while keeping the worker available for ingestion and retention.

## Source Maps

Source-map artifact storage is local-first. Set `SOURCE_MAPS_LOCAL_DIR` and `SOURCE_MAPS_MAX_UPLOAD_MB` in `.env` to control where the API stores uploaded `.map` files and the maximum upload size. Docker Compose mounts the `source_map_data` volume into the API at `/var/lib/signalhub/source-maps`, which matches the default `SOURCE_MAPS_LOCAL_DIR`.

Admins upload source maps from the console `Artifacts` mode after selecting a project and environment. Single `.map` files and `.zip` bundles are supported. Stack resolution uses strict project, environment, release, and minified filename matching; release values in ingested error payloads must match the uploaded artifact release.

Source-map artifact retention is local-first and worker-owned. Set `SOURCE_MAPS_RETENTION_ENABLED`, `SOURCE_MAPS_RETENTION_DAYS`, and `SOURCE_MAPS_RETENTION_BATCH_SIZE` to control cleanup. The scheduler runs with telemetry retention; setting `RETENTION_ENABLED=false` disables scheduled source-map cleanup too.

## Backups and Restore

Postgres logical backups are built into the worker. Set `BACKUPS_ENABLED=true`, `BACKUPS_INTERVAL_HOURS`, `BACKUPS_LOCAL_DIR`, and `BACKUPS_RETENTION_DAYS` in `.env` to control scheduled backups and local pruning. The Compose worker mounts `backup_data` at `/var/lib/signalhub/backups`, which matches the default `BACKUPS_LOCAL_DIR`.

The image includes `postgresql16-client` so `pg_dump` and `pg_restore` are available for backup scripts. Manual backups can be run with:

```sh
docker compose run --rm worker pnpm backup:create
```

Optional S3-compatible remote upload is configured with:

```dotenv
BACKUPS_S3_ENABLED=true
BACKUPS_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
BACKUPS_S3_REGION=auto
BACKUPS_S3_BUCKET=signalhub-backups
BACKUPS_S3_ACCESS_KEY_ID=<r2-access-key-id>
BACKUPS_S3_SECRET_ACCESS_KEY=<r2-secret-access-key>
BACKUPS_S3_PREFIX=production/signalhub
```

For Cloudflare R2 backup storage, use a private bucket and a scoped token. Remote backup retention is managed by bucket lifecycle rules in this slice. Source-map object storage remains deferred.

Restore is destructive and requires the API and worker to be stopped before running `pg_restore`:

```sh
docker compose stop api worker
docker compose run --rm worker pnpm backup:restore -- /var/lib/signalhub/backups/signalhub-YYYYMMDDTHHMMSSZ.dump --yes
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

For an existing Compose `postgres_data` volume, change the `signalhub` role password inside Postgres before changing `.env`. Then update `POSTGRES_PASSWORD`, update `POSTGRES_PASSWORD_URLENCODED` when needed, and restart API and worker.

## Verification

Before deployment or release:

```sh
pnpm test
pnpm build
docker compose config --quiet
pnpm run doctor
```

## Console Deployment

Production builds include `apps/console/dist`. The API serves the console at `/console` when `CONSOLE_ENABLED=true` or `NODE_ENV=production`, and exposes non-secret runtime config at `/console/config`.

Set `SIGNALHUB_PUBLIC_ENDPOINT` to the externally reachable API origin when SignalHub runs behind a domain, HTTPS reverse proxy, or non-default port. The console uses that value in SDK, HTTP, and environment snippets.

Local development can run the API with `pnpm dev:api` and the console with `pnpm dev:console`.
