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

The event rollup job (`EVENT_ROLLUPS_*`) must finish covering a given day in `event_actor_daily` before the retention job (`RETENTION_EVENTS_DAYS`) purges that day's raw `events` rows, or long-range retention queries would silently lose data for that day. This is mitigated by keeping `EVENT_ROLLUPS_LOOKBACK_DAYS` (default 400) well above `RETENTION_EVENTS_DAYS` (default 90) so the rollup's first-run backfill always finishes ahead of the purge window, and by the rollup never deleting its own rows in response to raw event retention — `event_actor_daily` outlives the purged `events` rows it summarized. Operators changing either setting should keep this ordering invariant: lookback days for rollups should stay comfortably larger than the raw events retention window.

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
