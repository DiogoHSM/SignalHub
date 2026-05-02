# SignalHub

SignalHub is a self-hosted telemetry core for product analytics, errors, LLM calls, traces, and spans. The API accepts telemetry with scoped API keys, queues ingestion jobs in Redis/BullMQ, and the worker persists sanitized telemetry into Postgres.

## Prerequisites

- Node.js 22
- pnpm 9
- Docker and Docker Compose

## Local Setup

1. Create local environment settings:

   ```sh
   cp .env.example .env
   ```

2. Edit `.env` and replace `SESSION_SECRET`, `API_KEY_PEPPER`, `BOOTSTRAP_ADMIN_PASSWORD`, and `POSTGRES_PASSWORD` with strong values. If `POSTGRES_PASSWORD` contains URL-reserved characters, set `POSTGRES_PASSWORD_URLENCODED` and the password segment in `DATABASE_URL` to the URL-encoded form of the same password.

3. Install dependencies:

   ```sh
   pnpm install
   ```

4. Start Postgres and Redis, then run migrations and seed the first admin:

   ```sh
   docker compose up -d postgres redis
   pnpm db:migrate
   pnpm seed:admin
   ```

   The API also runs migrations on startup for self-hosted deployments.

5. Start the API and worker in separate terminals:

   ```sh
   pnpm dev:api
   pnpm dev:worker
   ```

## Docker Compose

Docker Compose starts Postgres, Redis, the API, and the telemetry worker. It loads secrets from `.env` and overrides database/cache URLs for the internal Compose network. Postgres and Redis are bound to `127.0.0.1` for local tooling; change `POSTGRES_PORT`, `REDIS_PORT`, and `POSTGRES_PASSWORD` in `.env` before exposing the host.

```sh
cp .env.example .env
docker compose up -d postgres redis
docker compose run --rm api pnpm seed:admin
docker compose up --build
```

## Example Curl Flow

Log in as the bootstrap admin and keep the session cookie:

```sh
curl -i -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"change-me-admin-password-32-chars-min"}' \
  http://localhost:3000/auth/login
```

Create a project, environment, and API key:

```sh
curl -b cookies.txt -H "Content-Type: application/json" \
  -d '{"name":"Demo Project"}' \
  http://localhost:3000/admin/projects

curl -b cookies.txt -H "Content-Type: application/json" \
  -d '{"name":"production"}' \
  http://localhost:3000/admin/projects/prj_YOUR_PROJECT_ID/environments

curl -b cookies.txt -H "Content-Type: application/json" \
  -d '{"environmentId":"env_YOUR_ENVIRONMENT_ID","name":"Production ingest"}' \
  http://localhost:3000/admin/projects/prj_YOUR_PROJECT_ID/api-keys
```

Copy the one-time `secret` from the API key response. It is not stored or shown again.

Ingest an event:

```sh
curl -i -H "Authorization: Bearer sh_YOUR_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"name":"account.created","properties":{"plan":"pro"}}' \
  http://localhost:3000/v1/events
```

Query events with the admin session:

```sh
curl -b cookies.txt \
  "http://localhost:3000/query/events?project_id=prj_YOUR_PROJECT_ID&environment_id=env_YOUR_ENVIRONMENT_ID"
```
