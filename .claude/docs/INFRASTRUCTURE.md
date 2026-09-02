# Infrastructure

## Runtime Components

- API service: Fastify application exposing auth, admin, ingestion, query, health, and readiness routes.
- Worker service: BullMQ consumer that validates, sanitizes, and persists telemetry jobs.
- Scheduler service: optional split worker role for scheduled jobs such as alerts, monitors, retention, event rollups, and backups.
- Postgres: operational data and typed telemetry records.
- Redis: queue backend with append-only persistence enabled in Compose.

## Coolify Deployment

The live VPS deployment runs on Coolify (hosting moved from EasyPanel on 2026-07-26), in project `sigmon`, environment `production`. The applications `api`, `worker`, and `scheduler` are three separate Coolify applications built from the repository Dockerfile, with `WORKER_ROLE=queue` on the worker and `WORKER_ROLE=scheduler` on the scheduler. `postgres` and `redis` are Coolify-managed database resources on the same server. The `api` application serves `https://my.sigmon.app`; worker and scheduler have no public route.

Deploys are manual. GitHub Actions does not trigger deploys: after merging to `main`, the operator calls each application's Coolify deploy webhook by hand (or uses the panel's Deploy action). Deploy webhook URLs are operator secrets — keep them in the uncommitted root `SECRETS.md`, never in committed files or GitHub Actions secrets.

Do not redeploy Postgres or Redis from repository builds. They are stateful Coolify database resources managed directly in the panel.

Operator access details (Coolify panel URL, VPS address, SSH key access) are intentionally not committed; they live in the uncommitted root `SECRETS.md`.

## Cloudflare Tunnel (sigmon.app, www.sigmon.app)

`sigmon.app` and `www.sigmon.app` sit behind a Cloudflare Tunnel (`cloudflared` container on the VPS, token-based — ingress is managed remotely in the Cloudflare Zero Trust dashboard, not a local `config.yml`). `my.sigmon.app` is unaffected: it resolves with a direct A record straight to the VPS, no tunnel involved.

Both tunnel routes point at the Coolify Traefik origin (`https://127.0.0.1:443` / `https://localhost:443`) with **Disable TLS certificate verification** on and **Origin Server Name** set to the route's own hostname. This is required because Traefik has no Let's Encrypt certificate for these hostnames when reached this way (the ACME HTTP-01 challenge can't complete through the tunnel), so it falls back to a self-signed cert that fails default TLS validation — cloudflared logs `x509: cannot validate certificate for 127.0.0.1 because it doesn't contain any IP SANs` when this is misconfigured.

The api Coolify application must also have `sigmon.app` and `www.sigmon.app` listed (comma-separated, no stray punctuation) in its `Domains` field and be redeployed after any change there — Traefik's routing labels are baked in at container start, so a domain added to Coolify only takes effect after the next deploy of that application.

## Compose Defaults

- Postgres image: `postgres:16-alpine`.
- Redis image: `redis:7-alpine`.
- Postgres database: `sigmon`.
- Postgres user: `sigmon`.
- Postgres volume: `postgres_data`.
- Redis volume: `redis_data`.
- Backup volume: `backup_data`, mounted into the worker at `/var/lib/sigmon/backups`.
- Source-map volume: `source_map_data`, mounted into the API at `/var/lib/sigmon/source-maps`.
- Postgres host binding: `127.0.0.1:${POSTGRES_PORT:-5432}`.
- Redis host binding: `127.0.0.1:${REDIS_PORT:-6379}`.
- API host binding: `3000:3000`.

Compose healthchecks are defined for Postgres, Redis, API, and worker. The API healthcheck calls `/health`; the worker healthcheck verifies the worker process is alive.

The API and worker image runs as the non-root `sigmon` user under `tini`. It includes `curl` for healthchecks and `postgresql16-client` for backup and restore commands.

## Networking

The API and worker use Compose-internal service names:

- `postgres:5432`
- `redis:6379`

Local Node commands use `.env` values, usually:

- `DATABASE_URL` pointing at local Postgres with the same password as `POSTGRES_PASSWORD`.
- `REDIS_URL=redis://localhost:6379`

## Data Durability

Postgres data is stored in `postgres_data`. Redis uses append-only persistence and stores data in `redis_data`. Local backup dumps are stored in `backup_data`. Uploaded source-map artifacts are stored in `source_map_data`; their metadata and cached resolved-frame rows are stored in Postgres.

Optional remote backup storage can use an S3-compatible private bucket such as Cloudflare R2. The worker uploads backup dumps and SHA-256 sidecars when `BACKUPS_S3_ENABLED=true`; remote retention is controlled by bucket lifecycle rules.

Backup uploads retry transient network, timeout, rate-limit, and 5xx failures with bounded backoff. Permanent 4xx S3 failures fail fast so credential and bucket policy problems are visible instead of being retried blindly. Failed `pg_dump` runs remove partial dump files from the backup volume.

Source-map storage does not use object storage in this release line. The API owns local source-map writes, reads, and deletes under `SOURCE_MAPS_LOCAL_DIR`.

The worker prunes local source-map artifacts according to `SOURCE_MAPS_RETENTION_*`. Cleanup operates only under `SOURCE_MAPS_LOCAL_DIR`; object storage for source maps remains deferred.

## Event Rollup vs Retention Ordering

The event rollup job (`EVENT_ROLLUPS_*`) must finish covering a day in `event_actor_daily` before that scope's effective events policy deletes the raw `events` rows, or long-range cohort queries can lose that day. `RETENTION_EVENTS_DAYS` is only the installation fallback for events deletion and the fixed cohort raw-versus-rollup routing threshold; a scoped events value can delete raw rows sooner or keep them longer. Routing is not scope-aware, so a shorter scoped window can create a gap where the query still selects raw data after those rows were deleted. Set `EVENT_ROLLUPS_LOOKBACK_DAYS` (default 400) to cover the longest effective scoped events window or cohort range operators depend on, and monitor the rollup before retention runs. `event_actor_daily` is not selected by raw telemetry retention and remains after source `events` rows are deleted.

After running `pnpm db:migrate` for the migrations that introduce `event_actor_daily`/`event_rollup_state`, restart the worker so the new event rollup scheduler picks up the change.

## Operational Checks

- `pnpm run doctor` runs read-only local operator checks for prerequisites, `.env` shape, placeholder secrets, and safe configuration.
- `pnpm run doctor -- --compose --api-url http://localhost:3000` adds Compose-aware checks against the running stack.
- `docker compose config --quiet` validates Compose rendering.
- Compose checks cover rendered configuration, required services, service reachability, and API health through the configured `--api-url`.
- Production doctor checks fail when Compose would use the local-only Postgres password placeholder.
- `GET /ready` checks Postgres and Redis from the API process.
- Admin console users can run manual System actions through the API: doctor, backup, and retention. Doctor is read-only; backup writes a new dump to the configured backup target; retention deletes only expired retention-managed data according to the configured policy.
- Worker health is currently process-level; failed jobs are retried by BullMQ according to queue behavior.
