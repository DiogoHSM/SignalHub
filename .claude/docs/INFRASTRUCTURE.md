# Infrastructure

## Runtime Components

- API service: Fastify application exposing auth, admin, ingestion, query, health, and readiness routes.
- Worker service: BullMQ consumer that validates, sanitizes, and persists telemetry jobs.
- Postgres: operational data and typed telemetry records.
- Redis: queue backend with append-only persistence enabled in Compose.

## EasyPanel Deployment

The live VPS deployment uses EasyPanel services named `api`, `worker`, `postgres`, and `redis` in the `sigmon` project. The `api` and `worker` services are repository-built application services and may be redeployed through EasyPanel deploy hooks after GitHub Actions passes on `main`.

GitHub Actions secrets:

- `EASYPANEL_API_DEPLOY_URL`: deploy hook for the `api` service. `EASYPANEL_DEPLOY_URL` remains accepted as a legacy API-only alias.
- `EASYPANEL_WORKER_DEPLOY_URL`: deploy hook for the `worker` service.

Do not add deploy hooks for Postgres or Redis. They are stateful template services and should be managed directly in EasyPanel.

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

Source-map storage does not use object storage in this release line. The API owns local source-map writes, reads, and deletes under `SOURCE_MAPS_LOCAL_DIR`.

The worker prunes local source-map artifacts according to `SOURCE_MAPS_RETENTION_*`. Cleanup operates only under `SOURCE_MAPS_LOCAL_DIR`; object storage for source maps remains deferred.

## Operational Checks

- `pnpm run doctor` runs read-only local operator checks for prerequisites, `.env` shape, placeholder secrets, and safe configuration.
- `pnpm run doctor -- --compose --api-url http://localhost:3000` adds Compose-aware checks against the running stack.
- `docker compose config --quiet` validates Compose rendering.
- Compose checks cover rendered configuration, required services, service reachability, and API health through the configured `--api-url`.
- Production doctor checks fail when Compose would use the local-only Postgres password placeholder.
- `GET /ready` checks Postgres and Redis from the API process.
- Worker health is currently process-level; failed jobs are retried by BullMQ according to queue behavior.
