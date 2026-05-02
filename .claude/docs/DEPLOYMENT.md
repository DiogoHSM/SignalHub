# Deployment

Docker Compose is the primary Phase 1 installation path.

## Local Compose

1. Create `.env` from `.env.example`.
2. Replace secrets and database password.
3. Start dependencies:

   ```sh
   docker compose up -d postgres redis
   ```

4. Seed the bootstrap admin:

   ```sh
   docker compose run --rm api pnpm seed:admin
   ```

5. Start the stack:

   ```sh
   docker compose up --build
   ```

## Services

- `postgres`: Postgres 16, bound to `127.0.0.1:${POSTGRES_PORT:-5432}`.
- `redis`: Redis 7 with append-only persistence, bound to `127.0.0.1:${REDIS_PORT:-6379}`.
- `api`: Fastify API on host port `3000`.
- `worker`: BullMQ telemetry worker.

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
docker compose config
```
