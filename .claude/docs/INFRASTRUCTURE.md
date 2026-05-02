# Infrastructure

## Runtime Components

- API service: Fastify application exposing auth, admin, ingestion, query, health, and readiness routes.
- Worker service: BullMQ consumer that validates, sanitizes, and persists telemetry jobs.
- Postgres: operational data and typed telemetry records.
- Redis: queue backend with append-only persistence enabled in Compose.

## Compose Defaults

- Postgres image: `postgres:16-alpine`.
- Redis image: `redis:7-alpine`.
- Postgres database: `signalhub`.
- Postgres user: `signalhub`.
- Postgres volume: `postgres_data`.
- Redis volume: `redis_data`.
- Postgres host binding: `127.0.0.1:${POSTGRES_PORT:-5432}`.
- Redis host binding: `127.0.0.1:${REDIS_PORT:-6379}`.
- API host binding: `3000:3000`.

## Networking

The API and worker use Compose-internal service names:

- `postgres:5432`
- `redis:6379`

Local Node commands use `.env` values, usually:

- `DATABASE_URL=postgres://signalhub:...@localhost:5432/signalhub`
- `REDIS_URL=redis://localhost:6379`

## Data Durability

Postgres data is stored in `postgres_data`. Redis uses append-only persistence and stores data in `redis_data`.

## Operational Checks

- `docker compose config` validates Compose rendering.
- `GET /ready` checks Postgres and Redis from the API process.
- Worker health is currently process-level; failed jobs are retried by BullMQ according to queue behavior.
